import assert from "node:assert/strict";
import test from "node:test";

import {
  FormatSkeletonError,
  captureFormatSkeleton,
  validateFormatSkeletonEdit,
  validateFormatSkeletonTransaction,
} from "../app/lib/format-skeleton.js";
import { RuntimeDomSourceMap } from "../app/lib/runtime-dom-source-map.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
} from "../app/lib/source-index.js";
import { buildSourceTextMap } from "../app/lib/source-text-map.js";

const BASE_STYLE = Object.freeze({
  fontWeight: "400",
  fontStyle: "normal",
  fontSize: "16px",
  color: "rgb(20, 20, 20)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  textDecorationLine: "none",
  textDecorationStyle: "solid",
  textDecorationColor: "rgb(20, 20, 20)",
});

function textNode(data) {
  return {
    nodeType: 3,
    data,
    nodeValue: data,
    childNodes: [],
    parentNode: null,
  };
}

function elementNode(tagName, attributes = {}, style = {}) {
  const attributeMap = new Map(Object.entries(attributes));
  const node = {
    nodeType: 1,
    localName: tagName.toLowerCase(),
    tagName: tagName.toUpperCase(),
    attributes: attributeMap,
    childNodes: [],
    parentNode: null,
    _computedStyle: { ...BASE_STYLE, ...style },
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    getAttribute(name) {
      return attributeMap.get(String(name).toLowerCase()) ?? null;
    },
    setAttribute(name, value) {
      attributeMap.set(String(name).toLowerCase(), String(value));
    },
    removeAttribute(name) {
      attributeMap.delete(String(name).toLowerCase());
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
  Object.defineProperty(node, "innerHTML", {
    get() {
      throw new Error("FormatSkeleton must never read innerHTML");
    },
    set() {
      throw new Error("FormatSkeleton must never write innerHTML");
    },
  });
  return node;
}

function parseInlineStyle(value) {
  const result = {};
  for (const declaration of String(value ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (name === "font-size") result.fontSize = propertyValue;
    if (name === "font-weight") result.fontWeight = propertyValue;
    if (name === "font-style") result.fontStyle = propertyValue;
    if (name === "color") result.color = propertyValue;
    if (name === "background-color") result.backgroundColor = propertyValue;
    if (name === "text-decoration") result.textDecorationLine = propertyValue;
  }
  return result;
}

function computedStyleFor(sourceElement, inheritedStyle) {
  const style = { ...inheritedStyle };
  if (sourceElement.tagName === "strong" || sourceElement.tagName === "b") {
    style.fontWeight = "700";
  }
  if (sourceElement.tagName === "em" || sourceElement.tagName === "i") {
    style.fontStyle = "italic";
  }
  if (sourceElement.tagName === "a") {
    style.textDecorationLine = "underline";
  }
  const inlineStyle = sourceElement.attributesByName.get("style")?.[0]?.value;
  return { ...style, ...parseInlineStyle(inlineStyle) };
}

function fixture(html, rootId = "copy") {
  const index = buildSourceIndex(html);
  const sourceRoot = index.elements.find(
    (element) => element.stableAttributes.id === rootId,
  );
  assert.ok(sourceRoot, `missing fixture root #${rootId}`);
  const sourceMap = buildSourceTextMap(index, sourceRoot.nodeId, { allowEmpty: true });
  const runtimeMap = new RuntimeDomSourceMap({ epoch: index.sourceSha256 });
  const elementsBySourceId = new Map();
  const textBySourceId = new Map();

  const build = (sourceNode, inheritedStyle = BASE_STYLE) => {
    if (sourceNode.type === "text") {
      const node = textNode(sourceNode.value);
      runtimeMap.bindText(node, {
        spans: sourceNode.value.length > 0
          ? [{
              domStart: 0,
              domEnd: sourceNode.value.length,
              textNodeId: sourceNode.nodeId,
              sourceStartOffset: 0,
              sourceEndOffset: sourceNode.value.length,
            }]
          : [],
      });
      textBySourceId.set(sourceNode.nodeId, node);
      return node;
    }
    assert.equal(sourceNode.type, "element");
    const attributes = Object.fromEntries(
      sourceNode.attributes.map((attribute) => [
        attribute.name,
        attribute.value ?? attribute.rawValue ?? "",
      ]),
    );
    attributes[SOURCE_NODE_ATTRIBUTE] = sourceNode.nodeId;
    const style = computedStyleFor(sourceNode, inheritedStyle);
    const node = elementNode(sourceNode.tagName, attributes, style);
    runtimeMap.bindElement(node, { sourceNodeId: sourceNode.nodeId });
    elementsBySourceId.set(sourceNode.nodeId, node);
    for (const childId of sourceNode.childIds) {
      const child = index.byNodeId.get(childId);
      if (child.type === "comment") continue;
      node.appendChild(build(child, style));
    }
    return node;
  };

  const root = build(sourceRoot);
  const getComputedStyle = (node) => node._computedStyle;
  const skeleton = captureFormatSkeleton(index, sourceMap, {
    root,
    runtimeMap,
    getComputedStyle,
  });
  return {
    index,
    sourceRoot,
    sourceMap,
    runtimeMap,
    root,
    skeleton,
    elementsBySourceId,
    textBySourceId,
    getComputedStyle,
  };
}

function sourceElementByTag(value, tagName, ordinal = 0) {
  const matches = value.index.elements.filter((element) => element.tagName === tagName);
  assert.ok(matches[ordinal], `missing <${tagName}> #${ordinal}`);
  return matches[ordinal];
}

function replaceChild(parent, current, replacements) {
  const index = parent.childNodes.indexOf(current);
  assert.notEqual(index, -1);
  for (const replacement of replacements) replacement.parentNode = parent;
  parent.childNodes.splice(index, 1, ...replacements);
  current.parentNode = null;
}

test("captures source segments, nested wrapper coverage, exact attributes, styles, and link boundaries", () => {
  const value = fixture(
    `<p id="copy" class="lead" style='font-size:18px'>A<strong data-x="1">B<em>C</em></strong><a href="/docs" class="link">D</a>E</p>`,
  );
  const strong = sourceElementByTag(value, "strong");
  const emphasis = sourceElementByTag(value, "em");
  const link = sourceElementByTag(value, "a");
  const strongRecord = value.skeleton.wrappers.find(({ nodeId }) => nodeId === strong.nodeId);
  const emphasisRecord = value.skeleton.wrappers.find(({ nodeId }) => nodeId === emphasis.nodeId);

  assert.equal(value.skeleton.text, "ABCDE");
  assert.deepEqual(
    value.skeleton.sourceSegments.map(({ decodedText }) => decodedText),
    ["A", "B", "C", "D", "E"],
  );
  assert.deepEqual(
    [strongRecord.textStart, strongRecord.textEnd],
    [1, 3],
  );
  assert.equal(emphasisRecord.parentWrapperNodeId, strong.nodeId);
  assert.deepEqual(emphasisRecord.ancestorWrapperNodeIds, [strong.nodeId]);
  assert.equal(strongRecord.criticalStyle["font-weight"], "700");
  assert.equal(emphasisRecord.criticalStyle["font-style"], "italic");
  assert.equal(
    strongRecord.sourceAttributes.find(({ name }) => name === "data-x").raw,
    `data-x="1"`,
  );
  assert.deepEqual(value.skeleton.linkBoundaries, [{
    nodeId: link.nodeId,
    textStart: 3,
    textEnd: 4,
    href: "/docs",
  }]);
  assert.ok(value.skeleton.protectedSourceRanges.some(
    (range) => range.nodeId === link.nodeId && range.raw === `<a href="/docs" class="link">`,
  ));
});

test("captures authored hard-break identity, logical range, attributes, and exact source bytes", () => {
  const value = fixture(
    `<p id="copy">A<br class='keep' data-x=1>B</p>`,
  );
  const sourceBreak = sourceElementByTag(value, "br");
  const hardBreak = value.skeleton.hardBreaks[0];

  assert.equal(value.skeleton.text, "A\nB");
  assert.equal(value.skeleton.hardBreaks.length, 1);
  assert.deepEqual(
    {
      kind: hardBreak.kind,
      nodeId: hardBreak.nodeId,
      parentNodeId: hardBreak.parentNodeId,
      tagName: hardBreak.tagName,
      textStart: hardBreak.textStart,
      textEnd: hardBreak.textEnd,
    },
    {
      kind: "hard-break",
      nodeId: sourceBreak.nodeId,
      parentNodeId: value.sourceRoot.nodeId,
      tagName: "br",
      textStart: 1,
      textEnd: 2,
    },
  );
  assert.deepEqual(
    hardBreak.sourceAttributes.map(({ name, raw }) => ({ name, raw })),
    [
      { name: "class", raw: `class='keep'` },
      { name: "data-x", raw: "data-x=1" },
    ],
  );
  assert.deepEqual(hardBreak.domAttributes, [
    { name: "class", value: "keep" },
    { name: "data-x", value: "1" },
  ]);
  assert.deepEqual(hardBreak.protectedSourceRanges, [{
    nodeId: sourceBreak.nodeId,
    kind: "start-tag",
    startOffset: hardBreak.sourceStart,
    endOffset: hardBreak.sourceEnd,
    raw: `<br class='keep' data-x=1>`,
  }]);
  assert.ok(value.skeleton.protectedSourceRanges.some((range) => (
    range.nodeId === sourceBreak.nodeId
    && range.raw === `<br class='keep' data-x=1>`
  )));
});

test("keeps an authored hard break stable across edits before, after, and on both sides", () => {
  const before = fixture(`<p id="copy">A<br>B</p>`);
  const beforeRuns = before.sourceMap.runs.filter((run) => run.kind === "text");
  const beforeText = before.textBySourceId.get(beforeRuns[0].textNodeId);
  beforeText.data = "Left";
  beforeText.nodeValue = "Left";
  const beforeResult = validateFormatSkeletonEdit(before.skeleton, {
    root: before.root,
    runtimeMap: before.runtimeMap,
    getComputedStyle: before.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 1 },
  });
  assert.equal(beforeResult.ok, true);
  assert.ok(beforeResult.patch.protectedSourceRanges.some(
    (range) => range.nodeId === before.skeleton.hardBreaks[0].nodeId,
  ));

  const after = fixture(`<p id="copy">A<br>B</p>`);
  const afterRuns = after.sourceMap.runs.filter((run) => run.kind === "text");
  const afterText = after.textBySourceId.get(afterRuns[1].textNodeId);
  afterText.data = "Tail";
  afterText.nodeValue = "Tail";
  const afterResult = validateFormatSkeletonEdit(after.skeleton, {
    root: after.root,
    runtimeMap: after.runtimeMap,
    getComputedStyle: after.getComputedStyle,
    editRange: { startOffset: 2, endOffset: 3 },
  });
  assert.equal(afterResult.ok, true);

  const transaction = fixture(`<p id="copy">A<br>B</p>`);
  const transactionRuns = transaction.sourceMap.runs.filter(
    (run) => run.kind === "text",
  );
  const left = transaction.textBySourceId.get(transactionRuns[0].textNodeId);
  const right = transaction.textBySourceId.get(transactionRuns[1].textNodeId);
  left.data = "AA";
  left.nodeValue = "AA";
  right.data = "BB";
  right.nodeValue = "BB";
  const transactionResult = validateFormatSkeletonTransaction(transaction.skeleton, {
    root: transaction.root,
    runtimeMap: transaction.runtimeMap,
    getComputedStyle: transaction.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 1, nextText: "AA" },
      { startOffset: 2, endOffset: 3, nextText: "BB" },
    ],
  });
  assert.equal(transactionResult.ok, true);
  assert.equal(transactionResult.patch.replacements.length, 2);
});

test("rejects hard-break removal, duplication, parent drift, attribute drift, and runtime rebinding", () => {
  const removed = fixture(`<p id="copy">A<br>B</p>`);
  const removedBreak = sourceElementByTag(removed, "br");
  replaceChild(
    removed.root,
    removed.elementsBySourceId.get(removedBreak.nodeId),
    [elementNode("br")],
  );
  const removedResult = validateFormatSkeletonEdit(removed.skeleton, {
    root: removed.root,
    runtimeMap: removed.runtimeMap,
    getComputedStyle: removed.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 0 },
  });
  assert.equal(removedResult.ok, false);
  assert.equal(removedResult.code, "FORMAT_HARD_BREAK_REMOVED");

  const duplicated = fixture(`<p id="copy">A<br>B</p>`);
  const duplicatedBreak = sourceElementByTag(duplicated, "br");
  duplicated.root.appendChild(elementNode("br", {
    [SOURCE_NODE_ATTRIBUTE]: duplicatedBreak.nodeId,
  }));
  const duplicatedResult = validateFormatSkeletonEdit(duplicated.skeleton, {
    root: duplicated.root,
    runtimeMap: duplicated.runtimeMap,
    getComputedStyle: duplicated.getComputedStyle,
    editRange: { startOffset: 3, endOffset: 3 },
  });
  assert.equal(duplicatedResult.ok, false);
  assert.equal(duplicatedResult.code, "FORMAT_HARD_BREAK_IDENTITY_DUPLICATED");

  const moved = fixture(`<p id="copy">A<span>B</span><br>C</p>`);
  const movedBreak = sourceElementByTag(moved, "br");
  const movedSpan = sourceElementByTag(moved, "span");
  const movedBreakDom = moved.elementsBySourceId.get(movedBreak.nodeId);
  moved.root.childNodes = moved.root.childNodes.filter((node) => node !== movedBreakDom);
  moved.elementsBySourceId.get(movedSpan.nodeId).appendChild(movedBreakDom);
  const movedResult = validateFormatSkeletonEdit(moved.skeleton, {
    root: moved.root,
    runtimeMap: moved.runtimeMap,
    getComputedStyle: moved.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 0 },
  });
  assert.equal(movedResult.ok, false);
  assert.equal(movedResult.code, "FORMAT_HARD_BREAK_PARENT_CHANGED");

  const attributed = fixture(`<p id="copy">A<br class="keep">B</p>`);
  const attributedBreak = sourceElementByTag(attributed, "br");
  attributed.elementsBySourceId.get(attributedBreak.nodeId).setAttribute(
    "class",
    "changed",
  );
  const attributedResult = validateFormatSkeletonEdit(attributed.skeleton, {
    root: attributed.root,
    runtimeMap: attributed.runtimeMap,
    getComputedStyle: attributed.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 0 },
  });
  assert.equal(attributedResult.ok, false);
  assert.equal(attributedResult.code, "FORMAT_HARD_BREAK_ATTRIBUTES_CHANGED");

  const rebound = fixture(`<p id="copy">A<br>B</p>`);
  const reboundBreak = sourceElementByTag(rebound, "br");
  rebound.runtimeMap.unbindNode(rebound.elementsBySourceId.get(reboundBreak.nodeId));
  const reboundResult = validateFormatSkeletonEdit(rebound.skeleton, {
    root: rebound.root,
    runtimeMap: rebound.runtimeMap,
    getComputedStyle: rebound.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 0 },
  });
  assert.equal(reboundResult.ok, false);
  assert.equal(reboundResult.code, "FORMAT_HARD_BREAK_RUNTIME_MAPPING_CHANGED");
});

test("rejects a hard break whose logical range moves despite matching final text", () => {
  const value = fixture(`<p id="copy">A<br>B</p>`);
  const runs = value.sourceMap.runs.filter((run) => run.kind === "text");
  const beforeBreak = value.textBySourceId.get(runs[0].textNodeId);
  const afterBreak = value.textBySourceId.get(runs[1].textNodeId);
  beforeBreak.data = "A\n";
  beforeBreak.nodeValue = "A\n";
  afterBreak.data = "";
  afterBreak.nodeValue = "";

  const result = validateFormatSkeletonEdit(value.skeleton, {
    root: value.root,
    runtimeMap: value.runtimeMap,
    getComputedStyle: value.getComputedStyle,
    editRange: { startOffset: 2, endOffset: 3 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FORMAT_HARD_BREAK_COVERAGE_CHANGED");
});

test("protects the event-stable text-range layout guard as authored format skeleton", () => {
  const value = fixture(
    `<p id="copy">A<span style="all: unset; display: inline !important; font-weight: 700">B</span>C</p>`,
  );
  const wrapper = sourceElementByTag(value, "span");
  const wrapperRecord = value.skeleton.wrappers.find(
    ({ nodeId }) => nodeId === wrapper.nodeId,
  );
  const styleAttribute = wrapperRecord.sourceAttributes.find(
    ({ name }) => name === "style",
  );

  assert.equal(
    styleAttribute.raw,
    `style="all: unset; display: inline !important; font-weight: 700"`,
  );
  assert.equal(wrapperRecord.criticalStyle["font-weight"], "700");

  const wrapperDom = value.elementsBySourceId.get(wrapper.nodeId);
  wrapperDom.setAttribute(
    "style",
    "all: inherit; display: contents !important; font-weight: 700",
  );
  const wrapperText = value.textBySourceId.get(wrapper.textNodeIds[0]);
  wrapperText.data = "X";
  wrapperText.nodeValue = "X";
  const rejected = validateFormatSkeletonEdit(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    editRange: { startOffset: 1, endOffset: 2 },
  });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "FORMAT_WRAPPER_ATTRIBUTES_CHANGED");
});

test("keeps decoded text ownership separate from authored entity bytes", () => {
  const value = fixture(`<p id="copy"><span>&amp;&#x1F600;X</span></p>`);
  const segment = value.skeleton.sourceSegments[0];
  assert.equal(value.skeleton.text, "&😀X");
  assert.equal(segment.decodedText, "&😀X");
  assert.equal(segment.raw, "&amp;&#x1F600;X");
  assert.equal(
    value.index.source.slice(segment.sourceStart, segment.sourceEnd),
    "&amp;&#x1F600;X",
  );
});

test("validates a same-wrapper replacement as deterministic source segments without reading innerHTML", () => {
  const value = fixture(`<p id="copy"><strong>Bold</strong> tail</p>`);
  const strong = sourceElementByTag(value, "strong");
  value.textBySourceId.get(strong.textNodeIds[0]).data = "Bxxd";
  value.textBySourceId.get(strong.textNodeIds[0]).nodeValue = "Bxxd";

  const result = validateFormatSkeletonEdit(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    expectedSourceSha256: value.index.sourceSha256,
    editRange: { startOffset: 1, endOffset: 3, affinity: "right" },
    finalSelection: { anchor: 3, focus: 3 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.patch.kind, "source-text-replacement");
  assert.equal(result.patch.beforeText, "ol");
  assert.equal(result.patch.replacementText, "xx");
  assert.deepEqual(result.patch.deleteSegments, [{
    textNodeId: strong.textNodeIds[0],
    startOffset: 1,
    endOffset: 3,
  }]);
  assert.deepEqual(result.patch.inheritFormatFrom.wrapperNodeIds, [strong.nodeId]);
  assert.deepEqual(result.patch.preserveWrapperNodeIds, [strong.nodeId]);
  assert.equal(result.patch.canonicalizeDom, false);
});

test("allows deterministic collapsed and internal link edits but rejects selections crossing links", () => {
  const internal = fixture(`<p id="copy">Go <a href="/docs">Link</a> now</p>`);
  const link = sourceElementByTag(internal, "a");
  const linkText = internal.textBySourceId.get(link.textNodeIds[0]);
  linkText.data = "Lint";
  linkText.nodeValue = "Lint";
  const accepted = validateFormatSkeletonEdit(internal.skeleton, {
    root: internal.root,
    getComputedStyle: internal.getComputedStyle,
    editRange: { startOffset: 6, endOffset: 7 },
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.patch.inheritFormatFrom.linkNodeId, link.nodeId);

  const crossing = fixture(
    `<p id="copy">A<a href="/one">B</a>C<a href="/two">D</a>E</p>`,
  );
  const rejected = validateFormatSkeletonEdit(crossing.skeleton, {
    root: crossing.root,
    getComputedStyle: crossing.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 4 },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "FORMAT_CROSS_LINK_EDIT");
  assert.equal(rejected.details.linkNodeIds.length, 2);

  const boundary = validateFormatSkeletonEdit(crossing.skeleton, {
    root: crossing.root,
    getComputedStyle: crossing.getComputedStyle,
    editRange: { startOffset: 1, endOffset: 1, affinity: "left" },
  });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.patch.inheritFormatFrom.linkNodeId, null);
});

test("preserves a partially covered formatting wrapper and gives replacement text the start style", () => {
  const value = fixture(`<p id="copy"><strong>AB</strong>CD</p>`);
  const strong = sourceElementByTag(value, "strong");
  const strongText = value.textBySourceId.get(strong.textNodeIds[0]);
  const trailing = value.sourceMap.runs.find(
    (run) => run.kind === "text" && run.textNodeId !== strong.textNodeIds[0],
  );
  strongText.data = "AX";
  strongText.nodeValue = "AX";
  value.textBySourceId.get(trailing.textNodeId).data = "D";
  value.textBySourceId.get(trailing.textNodeId).nodeValue = "D";

  const result = validateFormatSkeletonEdit(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    editRange: { startOffset: 1, endOffset: 3 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch.inheritFormatFrom.wrapperNodeIds, [strong.nodeId]);
  assert.deepEqual(result.patch.preserveWrapperNodeIds, [strong.nodeId]);
  assert.equal(result.patch.replacementText, "X");
});

test("derives format inheritance from the exact SourceTextMap insertion owner", () => {
  const value = fixture(`<p id="copy"><strong>AB</strong>CD</p>`);
  const strong = sourceElementByTag(value, "strong");
  const strongText = value.textBySourceId.get(strong.textNodeIds[0]);
  const trailingRun = value.sourceMap.runs.find(
    (run) => run.kind === "text" && run.textNodeId !== strong.textNodeIds[0],
  );
  strongText.data = "";
  strongText.nodeValue = "";
  value.textBySourceId.get(trailingRun.textNodeId).data = "XD";
  value.textBySourceId.get(trailingRun.textNodeId).nodeValue = "XD";

  const result = validateFormatSkeletonEdit(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 3 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.insertAt.kind, "child-boundary");
  assert.deepEqual(result.patch.inheritFormatFrom.wrapperNodeIds, []);
  assert.deepEqual(result.patch.removalEligibleWrapperNodeIds, [strong.nodeId]);
  assert.deepEqual(result.patch.preserveWrapperNodeIds, []);
  assert.equal(result.patch.canonicalizeDom, true);
});

test("expands only the wrapper selected by collapsed insertion affinity", () => {
  for (const affinity of ["right", "left"]) {
    const value = fixture(`<p id="copy"><em><strong>A</strong></em>B</p>`);
    const emphasis = sourceElementByTag(value, "em");
    const strong = sourceElementByTag(value, "strong");
    const strongText = value.textBySourceId.get(strong.textNodeIds[0]);
    strongText.data = affinity === "right" ? "XA" : "AX";
    strongText.nodeValue = strongText.data;
    const offset = affinity === "right" ? 0 : 1;
    const result = validateFormatSkeletonEdit(value.skeleton, {
      root: value.root,
      getComputedStyle: value.getComputedStyle,
      editRange: { startOffset: offset, endOffset: offset, affinity },
    });
    assert.equal(result.ok, true, `${affinity}: ${result.code}`);
    assert.deepEqual(
      result.patch.inheritFormatFrom.wrapperNodeIds,
      [emphasis.nodeId, strong.nodeId],
    );
    assert.equal(result.patch.replacementText, "X");
  }
});

test("allows removal only for a fully covered disposable source wrapper", () => {
  const disposable = fixture(`<p id="copy"><em>Word</em> tail</p>`);
  const emphasis = sourceElementByTag(disposable, "em");
  const emphasisDom = disposable.elementsBySourceId.get(emphasis.nodeId);
  replaceChild(disposable.root, emphasisDom, [textNode("你好")]);
  const accepted = validateFormatSkeletonEdit(disposable.skeleton, {
    root: disposable.root,
    getComputedStyle: disposable.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 4 },
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.patch.domMissingDisposableWrapperNodeIds, [emphasis.nodeId]);
  assert.deepEqual(accepted.patch.preserveWrapperNodeIds, [emphasis.nodeId]);
  assert.deepEqual(accepted.patch.removalEligibleWrapperNodeIds, []);
  assert.equal(accepted.patch.canonicalizeDom, true);

  const partial = fixture(`<p id="copy"><em>Word</em> tail</p>`);
  const partialEmphasis = sourceElementByTag(partial, "em");
  replaceChild(
    partial.root,
    partial.elementsBySourceId.get(partialEmphasis.nodeId),
    [textNode("Wxxd")],
  );
  const rejectedPartial = validateFormatSkeletonEdit(partial.skeleton, {
    root: partial.root,
    getComputedStyle: partial.getComputedStyle,
    editRange: { startOffset: 1, endOffset: 3 },
  });
  assert.equal(rejectedPartial.ok, false);
  assert.equal(rejectedPartial.code, "FORMAT_PARTIAL_WRAPPER_REMOVED");

  const identified = fixture(`<p id="copy"><strong class="identity">Word</strong> tail</p>`);
  const identifiedStrong = sourceElementByTag(identified, "strong");
  replaceChild(
    identified.root,
    identified.elementsBySourceId.get(identifiedStrong.nodeId),
    [textNode("你好")],
  );
  const rejectedIdentified = validateFormatSkeletonEdit(identified.skeleton, {
    root: identified.root,
    getComputedStyle: identified.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 4 },
  });
  assert.equal(rejectedIdentified.ok, false);
  assert.equal(rejectedIdentified.code, "FORMAT_PROTECTED_WRAPPER_REMOVED");
});

test("accepts an attribute-free temporary IME wrapper only inside the replacement", () => {
  const value = fixture(`<p id="copy"><em>Word</em> tail</p>`);
  const emphasis = sourceElementByTag(value, "em");
  const temporary = elementNode("i", {}, { fontStyle: "italic" });
  temporary.appendChild(textNode("你好"));
  replaceChild(value.root, value.elementsBySourceId.get(emphasis.nodeId), [temporary]);
  const accepted = validateFormatSkeletonEdit(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 4 },
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.patch.temporaryWrappers, [{
    path: "0.0",
    tagName: "i",
    textStart: 0,
    textEnd: 2,
  }]);
  assert.equal(accepted.patch.canonicalizeDom, true);

  const unsafe = fixture(`<p id="copy"><em>Word</em> tail</p>`);
  const unsafeEmphasis = sourceElementByTag(unsafe, "em");
  const attributed = elementNode("i", { class: "ime-owned" }, { fontStyle: "italic" });
  attributed.appendChild(textNode("你好"));
  replaceChild(unsafe.root, unsafe.elementsBySourceId.get(unsafeEmphasis.nodeId), [attributed]);
  const rejected = validateFormatSkeletonEdit(unsafe.skeleton, {
    root: unsafe.root,
    getComputedStyle: unsafe.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 4 },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "FORMAT_TEMPORARY_WRAPPER_UNSAFE");
});

test("ignores edit-session metadata only on the root while protecting authored attributes", () => {
  const value = fixture(`<p id="copy"><em><strong>AB</strong></em>C</p>`);
  const sessionAttributes = {
    "aria-label": "编辑正文",
    "aria-multiline": "true",
    autocapitalize: "off",
    autocomplete: "off",
    "data-gramm": "false",
    "data-html-canvas-editing": "true",
    "data-html-canvas-native-editing": "true",
    "data-html-canvas-selected": "part",
    role: "textbox",
    tabindex: "0",
  };
  for (const [name, attributeValue] of Object.entries(sessionAttributes)) {
    value.root.setAttribute(name, attributeValue);
  }
  const strong = sourceElementByTag(value, "strong");
  const strongText = value.textBySourceId.get(strong.textNodeIds[0]);
  strongText.data = "AXB";
  strongText.nodeValue = "AXB";

  const accepted = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    runtimeMap: value.runtimeMap,
    getComputedStyle: value.getComputedStyle,
    replacements: [{ startOffset: 1, endOffset: 1, nextText: "X" }],
    finalSelection: { anchor: 2, focus: 2 },
  });
  assert.equal(accepted.ok, true);

  value.elementsBySourceId.get(strong.nodeId).setAttribute(
    "aria-label",
    "authored wrapper drift",
  );
  const wrapperDrift = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    runtimeMap: value.runtimeMap,
    getComputedStyle: value.getComputedStyle,
    replacements: [{ startOffset: 1, endOffset: 1, nextText: "X" }],
    finalSelection: { anchor: 2, focus: 2 },
  });
  assert.equal(wrapperDrift.ok, false);
  assert.equal(wrapperDrift.code, "FORMAT_WRAPPER_ATTRIBUTES_CHANGED");

  value.elementsBySourceId.get(strong.nodeId).removeAttribute("aria-label");
  value.root.setAttribute("class", "authored-root-drift");
  const rootDrift = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    runtimeMap: value.runtimeMap,
    getComputedStyle: value.getComputedStyle,
    replacements: [{ startOffset: 1, endOffset: 1, nextText: "X" }],
    finalSelection: { anchor: 2, focus: 2 },
  });
  assert.equal(rootDrift.ok, false);
  assert.equal(rootDrift.code, "FORMAT_ROOT_ATTRIBUTES_CHANGED");
});

test("rejects authored attribute, href, critical style, and outside-coverage drift", () => {
  const href = fixture(`<p id="copy">A<a href="/safe" class="link">BC</a>D</p>`);
  const link = sourceElementByTag(href, "a");
  const linkDom = href.elementsBySourceId.get(link.nodeId);
  linkDom.setAttribute("href", "/changed");
  const hrefResult = validateFormatSkeletonEdit(href.skeleton, {
    root: href.root,
    getComputedStyle: href.getComputedStyle,
    editRange: { startOffset: 1, endOffset: 3 },
  });
  assert.equal(hrefResult.ok, false);
  assert.equal(hrefResult.code, "FORMAT_WRAPPER_ATTRIBUTES_CHANGED");

  const style = fixture(`<p id="copy">A<strong>BC</strong>D</p>`);
  const strong = sourceElementByTag(style, "strong");
  style.elementsBySourceId.get(strong.nodeId)._computedStyle.fontWeight = "400";
  const styleResult = validateFormatSkeletonEdit(style.skeleton, {
    root: style.root,
    getComputedStyle: style.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 1 },
  });
  assert.equal(styleResult.ok, false);
  assert.equal(styleResult.code, "FORMAT_WRAPPER_STYLE_CHANGED");

  const coverage = fixture(`<p id="copy"><strong>AB</strong>CD</p>`);
  const coverageStrong = sourceElementByTag(coverage, "strong");
  const wrapper = coverage.elementsBySourceId.get(coverageStrong.nodeId);
  const moved = wrapper.childNodes[0];
  wrapper.childNodes = [];
  moved.parentNode = coverage.root;
  coverage.root.childNodes.splice(1, 0, moved);
  const coverageResult = validateFormatSkeletonEdit(coverage.skeleton, {
    root: coverage.root,
    getComputedStyle: coverage.getComputedStyle,
    editRange: { startOffset: 2, endOffset: 3 },
  });
  assert.equal(coverageResult.ok, false);
  assert.equal(coverageResult.code, "FORMAT_OUTSIDE_WRAPPER_COVERAGE_CHANGED");
});

test("rejects text drift outside the explicit replacement and block-level DOM mutations", () => {
  const outside = fixture(`<p id="copy">Alpha Beta</p>`);
  const run = outside.sourceMap.runs[0];
  const text = outside.textBySourceId.get(run.textNodeId);
  text.data = "Xlpha Beto";
  text.nodeValue = "Xlpha Beto";
  const outsideResult = validateFormatSkeletonEdit(outside.skeleton, {
    root: outside.root,
    getComputedStyle: outside.getComputedStyle,
    editRange: { startOffset: 6, endOffset: 10 },
  });
  assert.equal(outsideResult.ok, false);
  assert.equal(outsideResult.code, "FORMAT_TEXT_OUTSIDE_EDIT_CHANGED");

  const block = fixture(`<p id="copy">Alpha</p>`);
  const nestedBlock = elementNode("div");
  nestedBlock.appendChild(textNode("Alpha"));
  block.root.childNodes = [nestedBlock];
  nestedBlock.parentNode = block.root;
  const blockResult = validateFormatSkeletonEdit(block.skeleton, {
    root: block.root,
    getComputedStyle: block.getComputedStyle,
    editRange: { startOffset: 0, endOffset: 5 },
  });
  assert.equal(blockResult.ok, false);
  assert.equal(blockResult.code, "FORMAT_DOM_BLOCK_BOUNDARY");
});

test("fails capture when runtime text ownership does not match SourceTextMap", () => {
  const html = `<p id="copy">Text</p>`;
  const index = buildSourceIndex(html);
  const sourceRoot = index.elements.find((element) => element.stableAttributes.id === "copy");
  const sourceMap = buildSourceTextMap(index, sourceRoot.nodeId);
  const root = elementNode("p", { [SOURCE_NODE_ATTRIBUTE]: sourceRoot.nodeId });
  const text = textNode("Text");
  root.appendChild(text);
  const runtimeMap = new RuntimeDomSourceMap();
  runtimeMap.bindElement(root, { sourceNodeId: sourceRoot.nodeId });
  runtimeMap.bindText(text, {
    spans: [{
      domStart: 0,
      domEnd: 4,
      textNodeId: "text:not-the-source-owner",
      sourceStartOffset: 0,
      sourceEndOffset: 4,
    }],
  });

  assert.throws(
    () => captureFormatSkeleton(index, sourceMap, {
      root,
      runtimeMap,
      getComputedStyle: (node) => node._computedStyle,
    }),
    (error) => error instanceof FormatSkeletonError
      && error.code === "FORMAT_RUNTIME_TEXT_MAPPING_MISMATCH",
  );
});

test("returns the same validation descriptor for equivalent final DOM values", () => {
  const first = fixture(`<p id="copy">A<span style='color:red'>BC</span>D</p>`);
  const second = fixture(`<p id="copy">A<span style='color:red'>BC</span>D</p>`);
  const firstSpan = sourceElementByTag(first, "span");
  const secondSpan = sourceElementByTag(second, "span");
  first.textBySourceId.get(firstSpan.textNodeIds[0]).data = "BX";
  first.textBySourceId.get(firstSpan.textNodeIds[0]).nodeValue = "BX";
  second.textBySourceId.get(secondSpan.textNodeIds[0]).data = "BX";
  second.textBySourceId.get(secondSpan.textNodeIds[0]).nodeValue = "BX";

  const options = { editRange: { startOffset: 2, endOffset: 3 } };
  const left = validateFormatSkeletonEdit(first.skeleton, {
    ...options,
    root: first.root,
    getComputedStyle: first.getComputedStyle,
  });
  const right = validateFormatSkeletonEdit(second.skeleton, {
    ...options,
    root: second.root,
    getComputedStyle: second.getComputedStyle,
  });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.deepEqual(left, right);
});

test("validates two discontiguous replacements in baseline coordinates without merging them", () => {
  const value = fixture(
    `<p id="copy"><strong class="keep">Alpha</strong>--<em style='color:red'>Omega</em></p>`,
  );
  const strong = sourceElementByTag(value, "strong");
  const emphasis = sourceElementByTag(value, "em");
  const strongText = value.textBySourceId.get(strong.textNodeIds[0]);
  const emphasisText = value.textBySourceId.get(emphasis.textNodeIds[0]);
  strongText.data = "AXha";
  strongText.nodeValue = "AXha";
  emphasisText.data = "OmYZQa";
  emphasisText.nodeValue = "OmYZQa";

  const result = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    expectedSourceSha256: value.index.sourceSha256,
    // Input order is intentionally reversed. Output is deterministic source order,
    // while inputIndex keeps the caller's identity.
    replacements: [
      { startOffset: 9, endOffset: 11, nextText: "YZQ" },
      { startOffset: 1, endOffset: 3, nextText: "X" },
    ],
    finalSelection: { anchor: 11, focus: 11 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.patch.kind, "source-text-transaction");
  assert.equal(result.patch.replacements.length, 2);
  assert.deepEqual(
    result.patch.replacements.map(({ inputIndex, editRange, finalRange }) => ({
      inputIndex,
      editRange,
      finalRange,
    })),
    [
      {
        inputIndex: 1,
        editRange: { startOffset: 1, endOffset: 3, affinity: "right" },
        finalRange: { startOffset: 1, endOffset: 2 },
      },
      {
        inputIndex: 0,
        editRange: { startOffset: 9, endOffset: 11, affinity: "right" },
        finalRange: { startOffset: 8, endOffset: 11 },
      },
    ],
  );
  assert.deepEqual(
    result.patch.replacements.map(({ beforeText, nextText }) => ({ beforeText, nextText })),
    [
      { beforeText: "lp", nextText: "X" },
      { beforeText: "eg", nextText: "YZQ" },
    ],
  );
  assert.deepEqual(result.patch.preserveWrapperNodeIds, [strong.nodeId, emphasis.nodeId]);
  assert.equal(result.patch.canonicalizeDom, false);
});

test("normalizes a single explicit replacement into the transaction descriptor", () => {
  const value = fixture(`<p id="copy">ABC</p>`);
  const run = value.sourceMap.runs[0];
  const text = value.textBySourceId.get(run.textNodeId);
  text.data = "AXC";
  text.nodeValue = "AXC";
  const result = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    replacements: [{ startOffset: 1, endOffset: 2, nextText: "X" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, "FORMAT_SKELETON_TRANSACTION_VALID");
  assert.equal(result.patch.kind, "source-text-transaction");
  assert.deepEqual(result.patch.replacements, [{
    replacementIndex: 0,
    inputIndex: 0,
    editRange: { startOffset: 1, endOffset: 2, affinity: "right" },
    finalRange: { startOffset: 1, endOffset: 2 },
    beforeText: "B",
    nextText: "X",
    deleteSegments: [{
      textNodeId: run.textNodeId,
      startOffset: 1,
      endOffset: 2,
    }],
    insertAt: {
      kind: "text",
      textNodeId: run.textNodeId,
      utf16Offset: 1,
      affinity: "right",
    },
    inheritFormatFrom: {
      textOffset: 1,
      affinity: "right",
      wrapperNodeIds: [],
      linkNodeId: null,
    },
  }]);
});

test("keeps raw entity bytes between discontiguous replacements outside every patch descriptor", () => {
  const value = fixture(`<p id="copy">A&amp;B&#x1F600;C</p>`);
  const run = value.sourceMap.runs[0];
  const text = value.textBySourceId.get(run.textNodeId);
  text.data = "X&B😀Z";
  text.nodeValue = "X&B😀Z";

  const result = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 1, nextText: "X" },
      { startOffset: 5, endOffset: 6, nextText: "Z" },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.replacements.length, 2);
  assert.deepEqual(
    result.patch.replacements.map(({ deleteSegments }) => deleteSegments),
    [
      [{ textNodeId: run.textNodeId, startOffset: 0, endOffset: 1 }],
      [{ textNodeId: run.textNodeId, startOffset: 5, endOffset: 6 }],
    ],
  );
  assert.equal(result.patch.replacements[0].beforeText, "A");
  assert.equal(result.patch.replacements[1].beforeText, "C");
  assert.equal(JSON.stringify(result.patch).includes("&amp;B&#x1F600;"), false);
  assert.equal(value.index.source.includes("&amp;B&#x1F600;"), true);
});

test("rejects overlapping replacements and an exact-final-text mismatch", () => {
  const overlap = fixture(`<p id="copy">ABCDE</p>`);
  const overlapResult = validateFormatSkeletonTransaction(overlap.skeleton, {
    root: overlap.root,
    getComputedStyle: overlap.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 3, nextText: "X" },
      { startOffset: 2, endOffset: 4, nextText: "Y" },
    ],
  });
  assert.equal(overlapResult.ok, false);
  assert.equal(overlapResult.code, "FORMAT_TRANSACTION_REPLACEMENTS_OVERLAP");

  const mismatch = fixture(`<p id="copy">ABCDE</p>`);
  const mismatchResult = validateFormatSkeletonTransaction(mismatch.skeleton, {
    root: mismatch.root,
    getComputedStyle: mismatch.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 1, nextText: "X" },
      { startOffset: 4, endOffset: 5, nextText: "Z" },
    ],
  });
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.code, "FORMAT_TRANSACTION_FINAL_TEXT_MISMATCH");
  assert.equal(mismatchResult.details.expectedText, "XBCDZ");
  assert.equal(mismatchResult.details.actualText, "ABCDE");
});

test("computes disposable-wrapper cleanup from the union without merging replacements", () => {
  const value = fixture(`<p id="copy"><em>ABCD</em> tail</p>`);
  const emphasis = sourceElementByTag(value, "em");
  replaceChild(value.root, value.elementsBySourceId.get(emphasis.nodeId), []);

  const result = validateFormatSkeletonTransaction(value.skeleton, {
    root: value.root,
    getComputedStyle: value.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 2, nextText: "" },
      { startOffset: 2, endOffset: 4, nextText: "" },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.replacements.length, 2);
  assert.deepEqual(result.patch.removalEligibleWrapperNodeIds, [emphasis.nodeId]);
  assert.deepEqual(result.patch.domMissingDisposableWrapperNodeIds, [emphasis.nodeId]);
  assert.deepEqual(result.patch.preserveWrapperNodeIds, []);
  assert.equal(result.patch.canonicalizeDom, true);
});

test("allows temporary wrappers only inside one projected replacement region", () => {
  const accepted = fixture(`<p id="copy">AB--CD</p>`);
  const first = elementNode("i", {}, { fontStyle: "italic" });
  first.appendChild(textNode("X"));
  const second = elementNode("b", {}, { fontWeight: "700" });
  second.appendChild(textNode("Y"));
  accepted.root.childNodes = [first, textNode("--"), second];
  for (const child of accepted.root.childNodes) child.parentNode = accepted.root;
  const acceptedResult = validateFormatSkeletonTransaction(accepted.skeleton, {
    root: accepted.root,
    getComputedStyle: accepted.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 2, nextText: "X" },
      { startOffset: 4, endOffset: 6, nextText: "Y" },
    ],
  });
  assert.equal(acceptedResult.ok, true);
  assert.deepEqual(
    acceptedResult.patch.temporaryWrappers.map(({ replacementIndex }) => replacementIndex),
    [0, 1],
  );

  const spanning = fixture(`<p id="copy">AB--CD</p>`);
  const unsafe = elementNode("i", {}, { fontStyle: "italic" });
  unsafe.appendChild(textNode("X--Y"));
  spanning.root.childNodes = [unsafe];
  unsafe.parentNode = spanning.root;
  const rejectedResult = validateFormatSkeletonTransaction(spanning.skeleton, {
    root: spanning.root,
    getComputedStyle: spanning.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 2, nextText: "X" },
      { startOffset: 4, endOffset: 6, nextText: "Y" },
    ],
  });
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejectedResult.code, "FORMAT_TEMPORARY_WRAPPER_UNSAFE");
});

test("multi-replacement transactions preserve link and computed-style boundaries", () => {
  const linkValue = fixture(`<p id="copy">A<a href="/safe">BC</a>DE</p>`);
  const linkRuns = linkValue.sourceMap.runs.filter((run) => run.kind === "text");
  linkValue.textBySourceId.get(linkRuns[0].textNodeId).data = "X";
  linkValue.textBySourceId.get(linkRuns[0].textNodeId).nodeValue = "X";
  linkValue.textBySourceId.get(linkRuns[1].textNodeId).data = "C";
  linkValue.textBySourceId.get(linkRuns[1].textNodeId).nodeValue = "C";
  linkValue.textBySourceId.get(linkRuns[2].textNodeId).data = "DY";
  linkValue.textBySourceId.get(linkRuns[2].textNodeId).nodeValue = "DY";
  const crossing = validateFormatSkeletonTransaction(linkValue.skeleton, {
    root: linkValue.root,
    getComputedStyle: linkValue.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 2, nextText: "X" },
      { startOffset: 4, endOffset: 5, nextText: "Y" },
    ],
  });
  assert.equal(crossing.ok, false);
  assert.equal(crossing.code, "FORMAT_CROSS_LINK_EDIT");

  const styled = fixture(`<p id="copy"><strong>AB</strong>--CD</p>`);
  const strong = sourceElementByTag(styled, "strong");
  const run = styled.sourceMap.runs.find(
    (candidate) => candidate.kind === "text" && candidate.textNodeId !== strong.textNodeIds[0],
  );
  styled.textBySourceId.get(strong.textNodeIds[0]).data = "XB";
  styled.textBySourceId.get(strong.textNodeIds[0]).nodeValue = "XB";
  styled.textBySourceId.get(run.textNodeId).data = "--CY";
  styled.textBySourceId.get(run.textNodeId).nodeValue = "--CY";
  styled.elementsBySourceId.get(strong.nodeId)._computedStyle.fontWeight = "400";
  const styleResult = validateFormatSkeletonTransaction(styled.skeleton, {
    root: styled.root,
    getComputedStyle: styled.getComputedStyle,
    replacements: [
      { startOffset: 0, endOffset: 1, nextText: "X" },
      { startOffset: 5, endOffset: 6, nextText: "Y" },
    ],
  });
  assert.equal(styleResult.ok, false);
  assert.equal(styleResult.code, "FORMAT_WRAPPER_STYLE_CHANGED");
});
