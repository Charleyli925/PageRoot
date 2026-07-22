import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_NODE_ATTRIBUTE,
  RuntimeDomSourceMap,
  RuntimeDomSourceMapError,
} from "../app/lib/runtime-dom-source-map.js";

function text(data) {
  return { data, nodeValue: data, parentNode: null };
}

function element(children = []) {
  const attributes = new Map();
  const node = {
    childNodes: children,
    parentNode: null,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    contains(candidate) {
      let cursor = candidate;
      while (cursor) {
        if (cursor === this) return true;
        cursor = cursor.parentNode;
      }
      return false;
    },
  };
  for (const child of children) child.parentNode = node;
  return node;
}

test("maps one DOM Text node to multiple source text nodes with boundary affinity", () => {
  const domText = text("甲乙");
  const root = element([domText]);
  const map = new RuntimeDomSourceMap({ epoch: "sha-a" });
  const rootId = map.bindElement(root, { sourceNodeId: "element:root" }, {
    exposeAttribute: true,
  });
  map.bindTextSequence(root, [{
    node: domText,
    spans: [
      {
        domStart: 0,
        domEnd: 1,
        textNodeId: "text:a",
        sourceStartOffset: 0,
        sourceEndOffset: 1,
      },
      {
        domStart: 1,
        domEnd: 2,
        textNodeId: "text:b",
        sourceStartOffset: 0,
        sourceEndOffset: 1,
      },
    ],
  }]);

  assert.equal(root.getAttribute(RUNTIME_NODE_ATTRIBUTE), rootId);
  assert.deepEqual(map.domPointToSourceAnchor(domText, 1, "left"), {
    kind: "text",
    textNodeId: "text:a",
    utf16Offset: 1,
    affinity: "left",
  });
  assert.deepEqual(map.domPointToSourceAnchor(domText, 1, "right"), {
    kind: "text",
    textNodeId: "text:b",
    utf16Offset: 0,
    affinity: "right",
  });
  assert.deepEqual(map.domRangeToSource(root, domText, 0, domText, 2), {
    collapsed: false,
    segments: [
      { textNodeId: "text:a", startOffset: 0, endOffset: 1 },
      { textNodeId: "text:b", startOffset: 0, endOffset: 1 },
    ],
    insertAt: {
      kind: "text",
      textNodeId: "text:a",
      utf16Offset: 0,
      affinity: "right",
    },
  });
});

test("maps split DOM Text nodes back to one source node and merges contiguous segments", () => {
  const first = text("甲");
  const second = text("乙");
  const root = element([first, second]);
  const map = new RuntimeDomSourceMap();
  map.bindTextSequence(root, [
    {
      node: first,
      spans: [{
        domStart: 0,
        domEnd: 1,
        textNodeId: "text:source",
        sourceStartOffset: 0,
        sourceEndOffset: 1,
      }],
    },
    {
      node: second,
      spans: [{
        domStart: 0,
        domEnd: 1,
        textNodeId: "text:source",
        sourceStartOffset: 1,
        sourceEndOffset: 2,
      }],
    },
  ]);

  assert.deepEqual(map.domRangeToSource(root, first, 0, second, 1).segments, [{
    textNodeId: "text:source",
    startOffset: 0,
    endOffset: 2,
  }]);
  assert.deepEqual(map.sourceAnchorToDomPoint({
    kind: "text",
    textNodeId: "text:source",
    utf16Offset: 1,
    affinity: "left",
  }, { root }), { node: first, offset: 1 });
  assert.deepEqual(map.sourceAnchorToDomPoint({
    kind: "text",
    textNodeId: "text:source",
    utf16Offset: 1,
    affinity: "right",
  }, { root }), { node: second, offset: 0 });
});

test("keeps a runtime identity when MutationObserver-driven rebinding replaces a Text node", () => {
  const before = text("AB");
  const after = text("AB");
  const root = element([before]);
  const map = new RuntimeDomSourceMap({ epoch: "stable" });
  const runtimeId = map.bindText(before, {
    spans: [{
      domStart: 0,
      domEnd: 2,
      textNodeId: "text:a",
      sourceStartOffset: 0,
      sourceEndOffset: 2,
    }],
  });
  root.childNodes = [after];
  after.parentNode = root;
  map.rebindRuntimeNode(runtimeId, after);

  assert.equal(map.runtimeIdForNode(before), null);
  assert.equal(map.runtimeIdForNode(after), runtimeId);
  assert.equal(map.nodeForRuntimeId(runtimeId), after);
  assert.deepEqual(map.domPointToSourceAnchor(after, 1), {
    kind: "text",
    textNodeId: "text:a",
    utf16Offset: 1,
    affinity: "right",
  });
});

test("maps authored element child boundaries and rejects unmapped text gaps", () => {
  const child = text("AB");
  const root = element([child]);
  const map = new RuntimeDomSourceMap();
  map.bindElement(root, { sourceNodeId: "element:root" });
  map.bindText(child, {
    spans: [{
      domStart: 0,
      domEnd: 1,
      textNodeId: "text:a",
      sourceStartOffset: 0,
      sourceEndOffset: 1,
    }],
  });

  assert.deepEqual(map.domPointToSourceAnchor(root, 0), {
    kind: "child-boundary",
    parentNodeId: "element:root",
    beforeNodeId: "text:a",
    affinity: "right",
  });
  assert.deepEqual(map.sourceAnchorToDomPoint({
    kind: "child-boundary",
    parentNodeId: "element:root",
    beforeNodeId: null,
    affinity: "left",
  }), { node: root, offset: 1 });
  assert.throws(
    () => map.domPointToSourceAnchor(child, 2),
    (error) => error instanceof RuntimeDomSourceMapError
      && error.code === "UNMAPPED_DOM_POINT",
  );
});

test("rejects surrogate-splitting and overlapping bindings before they can reach SourcePatch", () => {
  const emoji = text("😀");
  const map = new RuntimeDomSourceMap();
  assert.throws(
    () => map.bindText(emoji, {
      spans: [{
        domStart: 0,
        domEnd: 1,
        textNodeId: "text:a",
        sourceStartOffset: 0,
        sourceEndOffset: 1,
      }],
    }),
    (error) => error instanceof RuntimeDomSourceMapError
      && error.code === "UNSAFE_DOM_SOURCE_SPAN",
  );
});
