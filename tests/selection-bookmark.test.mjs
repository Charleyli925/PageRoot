import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeDomSourceMap } from "../app/lib/runtime-dom-source-map.js";
import {
  createSelectionBookmark,
  resolveSelectionBookmark,
  restoreSelectionBookmark,
} from "../app/lib/selection-bookmark.js";

function text(data) {
  return { data, parentNode: null };
}

function rootWith(children) {
  const root = {
    childNodes: children,
    parentNode: null,
    contains(candidate) {
      return candidate === this || candidate.parentNode === this;
    },
  };
  for (const child of children) child.parentNode = root;
  return root;
}

function bindText(map, root, nodes) {
  map.bindElement(root, { sourceNodeId: "element:root" });
  map.bindTextSequence(root, nodes.map((node, index) => ({
    node,
    spans: [{
      domStart: 0,
      domEnd: node.data.length,
      textNodeId: `text:${index}`,
      sourceStartOffset: 0,
      sourceEndOffset: node.data.length,
    }],
  })));
}

test("preserves backwards anchor/focus direction across runtime Text-node rebinding", () => {
  const first = text("AB");
  const second = text("CD");
  const root = rootWith([first, second]);
  const map = new RuntimeDomSourceMap({ epoch: "sha-a" });
  bindText(map, root, [first, second]);
  const selection = {
    anchorNode: second,
    anchorOffset: 2,
    focusNode: first,
    focusOffset: 1,
    isCollapsed: false,
  };
  const bookmark = createSelectionBookmark(selection, map, {
    root,
    sourceSha256: "sha-a",
    anchorAffinity: "left",
    focusAffinity: "right",
  });

  const nextFirst = text("AB");
  const nextSecond = text("CD");
  nextFirst.parentNode = root;
  nextSecond.parentNode = root;
  root.childNodes = [nextFirst, nextSecond];
  map.rebindRuntimeNode(map.runtimeIdForNode(first), nextFirst);
  map.rebindRuntimeNode(map.runtimeIdForNode(second), nextSecond);

  const restoredCalls = [];
  const nextSelection = {
    setBaseAndExtent(...args) {
      restoredCalls.push(args);
    },
  };
  assert.deepEqual(
    restoreSelectionBookmark(nextSelection, bookmark, map, {
      root,
      sourceSha256: "sha-a",
    }),
    { ok: true },
  );
  assert.deepEqual(restoredCalls, [[nextSecond, 2, nextFirst, 1]]);
});

test("fails closed on stale source revisions and missing mapped anchors", () => {
  const node = text("AB");
  const root = rootWith([node]);
  const map = new RuntimeDomSourceMap();
  bindText(map, root, [node]);
  const bookmark = createSelectionBookmark({
    anchorNode: node,
    anchorOffset: 1,
    focusNode: node,
    focusOffset: 1,
    isCollapsed: true,
  }, map, { root, sourceSha256: "sha-a" });

  assert.deepEqual(
    resolveSelectionBookmark(bookmark, map, { sourceSha256: "sha-b" }),
    {
      ok: false,
      code: "SELECTION_SOURCE_MISMATCH",
      reason: "The selection belongs to a different source revision.",
    },
  );
  map.unbindNode(node);
  const missing = resolveSelectionBookmark(bookmark, map, {
    root,
    sourceSha256: "sha-a",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "SOURCE_ANCHOR_NOT_MAPPED");
});

test("uses collapse plus extend as the direction-preserving fallback", () => {
  const node = text("AB");
  const root = rootWith([node]);
  const map = new RuntimeDomSourceMap();
  bindText(map, root, [node]);
  const bookmark = createSelectionBookmark({
    anchorNode: node,
    anchorOffset: 0,
    focusNode: node,
    focusOffset: 2,
    isCollapsed: false,
  }, map, { root });
  const calls = [];
  const selection = {
    collapse(...args) { calls.push(["collapse", ...args]); },
    extend(...args) { calls.push(["extend", ...args]); },
  };

  assert.deepEqual(restoreSelectionBookmark(selection, bookmark, map, { root }), {
    ok: true,
  });
  assert.deepEqual(calls, [
    ["collapse", node, 0],
    ["extend", node, 2],
  ]);
});
