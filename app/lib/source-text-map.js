import { resolveTargetRef } from "./target-resolver.js";

export const SOURCE_TEXT_HARD_BREAK = "\n";
export const SOURCE_TEXT_OBJECT = "\ufffc";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

// These elements do not introduce their own document-editing boundary. This
// is deliberately a semantic source list; computed layout never changes what
// SourcePatch is authorised to modify.
const TRANSPARENT_TEXT_ELEMENTS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

export class SourceTextMapError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourceTextMapError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SourceTextMapError(code, message, details);
}

function isSourceIndex(value) {
  return Boolean(
    value
    && typeof value.source === "string"
    && typeof value.sourceSha256 === "string"
    && value.byNodeId instanceof Map,
  );
}

function assertAffinity(affinity) {
  if (affinity !== "left" && affinity !== "right") {
    fail(
      "INVALID_SOURCE_AFFINITY",
      "Source affinity must be left or right.",
      { affinity },
    );
  }
}

function isUtf16Boundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff);
}

function assertTextBoundary(run, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > run.text.length) {
    fail(
      "SOURCE_TEXT_OFFSET_OUT_OF_RANGE",
      "The text offset is outside its source text node.",
      { textNodeId: run.textNodeId, offset, textLength: run.text.length },
    );
  }
  if (!isUtf16Boundary(run.text, offset)) {
    fail(
      "UNSAFE_UTF16_BOUNDARY",
      "The text offset splits a UTF-16 surrogate pair.",
      { textNodeId: run.textNodeId, offset },
    );
  }
}

function childBoundary(parentNodeId, beforeNodeId, affinity) {
  return {
    kind: "child-boundary",
    parentNodeId,
    beforeNodeId,
    affinity,
  };
}

function textAnchor(textNodeId, utf16Offset, affinity) {
  return {
    kind: "text",
    textNodeId,
    utf16Offset,
    affinity,
  };
}

function withAffinity(anchor, affinity) {
  return { ...anchor, affinity };
}

function beforeAnchorFor(node) {
  return childBoundary(node.parentId, node.nodeId, "right");
}

function afterAnchorFor(node) {
  return childBoundary(node.parentId, node.nextSiblingId ?? null, "left");
}

function resolveInputNode(index, target) {
  if (typeof target === "string") {
    return { node: index.byNodeId.get(target) ?? null, resolution: "exact" };
  }
  if (target && typeof target.nodeId === "string") {
    return { node: index.byNodeId.get(target.nodeId) ?? null, resolution: "exact" };
  }
  if (target && typeof target.targetId === "string") {
    try {
      const result = resolveTargetRef(index, target);
      return { node: result.target, resolution: result.resolution };
    } catch (error) {
      return { node: null, resolution: "orphaned", error };
    }
  }
  return { node: null, resolution: "orphaned" };
}

function hostForNode(index, node) {
  if (node?.type === "element") return node;
  if (node?.type !== "text" || !node.parentId) return null;
  const parent = index.byNodeId.get(node.parentId);
  return parent?.type === "element" ? parent : null;
}

function assertMap(map) {
  if (
    !map
    || !Array.isArray(map.runs)
    || !Number.isInteger(map.textLength)
    || typeof map.rootNodeId !== "string"
  ) {
    fail("INVALID_SOURCE_TEXT_MAP", "A valid SourceTextMap is required.");
  }
}

function assertTextOffset(map, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > map.textLength) {
    fail(
      "SOURCE_TEXT_OFFSET_OUT_OF_RANGE",
      "The text offset is outside the source text map.",
      { offset, textLength: map.textLength },
    );
  }
}

function assertTextRange(map, startOffset, endOffset) {
  assertTextOffset(map, startOffset);
  assertTextOffset(map, endOffset);
  if (endOffset < startOffset) {
    fail(
      "INVALID_SOURCE_TEXT_RANGE",
      "The text range end precedes its start.",
      { startOffset, endOffset },
    );
  }
}

function anchorAtStart(run) {
  if (run.kind === "text") return textAnchor(run.textNodeId, 0, "right");
  return run.beforeAnchor;
}

function anchorAtEnd(run) {
  if (run.kind === "text") {
    return textAnchor(run.textNodeId, run.text.length, "left");
  }
  return run.afterAnchor;
}

function pushBoundary(runs, kind, node, textOffset) {
  const character = kind === "hard-break"
    ? SOURCE_TEXT_HARD_BREAK
    : SOURCE_TEXT_OBJECT;
  runs.push({
    kind,
    nodeId: node.nodeId,
    parentNodeId: node.parentId,
    tagName: node.type === "element" ? node.tagName : null,
    sourceStart: node.range.startOffset,
    sourceEnd: node.range.endOffset,
    textStart: textOffset,
    textEnd: textOffset + character.length,
    beforeAnchor: beforeAnchorFor(node),
    afterAnchor: afterAnchorFor(node),
  });
  return textOffset + character.length;
}

/**
 * Build a source-only projection for one authored text island. It never reads
 * layout, creates wrappers, or changes the DOM. Structural children remain
 * explicit boundary runs so later capability checks can fail closed.
 */
export function buildSourceTextMap(index, target, options = {}) {
  if (!isSourceIndex(index)) {
    fail("INVALID_SOURCE_INDEX", "SourceTextMap requires an existing SourceIndex.");
  }
  const resolved = resolveInputNode(index, target);
  if (resolved.resolution === "ambiguous") {
    fail(
      "SOURCE_TARGET_AMBIGUOUS",
      "The source target does not resolve uniquely.",
    );
  }
  if (!resolved.node || resolved.resolution === "orphaned") {
    fail(
      "SOURCE_TARGET_ORPHANED",
      "The source target is not present in the current source.",
      resolved.error ? { cause: String(resolved.error.message ?? resolved.error) } : {},
    );
  }
  if (resolved.node.type === "insertion-point") {
    fail(
      "INSERTION_POINT_NOT_TEXT_HOST",
      "An insertion point cannot be used as a source text host.",
    );
  }

  const host = hostForNode(index, resolved.node);
  if (!host) {
    fail(
      "SOURCE_TEXT_HOST_NOT_ELEMENT",
      "The source node does not have an element text host.",
      { nodeId: resolved.node.nodeId },
    );
  }
  if (host.namespaceURI !== HTML_NAMESPACE) {
    fail(
      "NON_HTML_SOURCE_TEXT_HOST",
      "Foreign-content text requires a dedicated editor.",
      { nodeId: host.nodeId, namespaceURI: host.namespaceURI },
    );
  }
  if (!host.boundarySafe) {
    fail(
      "UNSAFE_SOURCE_BOUNDARY",
      "The text host does not have reliable source boundaries.",
      { nodeId: host.nodeId },
    );
  }

  const runs = [];
  const inlineRanges = [];
  let textOffset = 0;
  const visit = (node, depth = 0) => {
    if (!node) return;
    if (node.type === "text") {
      if (node.value.length === 0) return;
      runs.push({
        kind: "text",
        textNodeId: node.nodeId,
        parentNodeId: node.parentId,
        text: node.value,
        sourceStart: node.range.startOffset,
        sourceEnd: node.range.endOffset,
        textStart: textOffset,
        textEnd: textOffset + node.value.length,
      });
      textOffset += node.value.length;
      return;
    }
    if (node.type === "comment") {
      if (options.ignoreComments === true) return;
      textOffset = pushBoundary(runs, "structure", node, textOffset);
      return;
    }
    if (node.type !== "element") return;
    // <wbr> is an authored zero-width line-break opportunity. It contributes
    // no logical character in Chromium, so keeping it out of the text stream
    // makes source and DOM offsets agree while editable-island preserves the
    // element itself as an immutable atom.
    if (node.tagName === "wbr") return;
    if (node.tagName === "br") {
      textOffset = pushBoundary(runs, "hard-break", node, textOffset);
      return;
    }
    if (
      node.namespaceURI !== HTML_NAMESPACE
      || !TRANSPARENT_TEXT_ELEMENTS.has(node.tagName)
    ) {
      textOffset = pushBoundary(runs, "structure", node, textOffset);
      return;
    }
    const rangeStart = textOffset;
    for (const childId of node.childIds) {
      visit(index.byNodeId.get(childId), depth + 1);
    }
    inlineRanges.push({
      nodeId: node.nodeId,
      parentNodeId: node.parentId,
      tagName: node.tagName,
      textStart: rangeStart,
      textEnd: textOffset,
      beforeAnchor: beforeAnchorFor(node),
      depth,
    });
  };

  for (const childId of host.childIds) visit(index.byNodeId.get(childId), 0);
  const textRunCount = runs.filter((run) => run.kind === "text").length;
  if (textRunCount === 0 && options.allowEmpty !== true) {
    fail(
      "NO_SOURCE_TEXT",
      "The selected host has no source-backed text.",
      { nodeId: host.nodeId },
    );
  }

  return {
    sourceSha256: index.sourceSha256,
    rootNodeId: host.nodeId,
    rootTagName: host.tagName,
    resolution: resolved.resolution,
    textLength: textOffset,
    text: runs.map((run) => {
      if (run.kind === "text") return run.text;
      return run.kind === "hard-break" ? SOURCE_TEXT_HARD_BREAK : SOURCE_TEXT_OBJECT;
    }).join(""),
    startAnchor: childBoundary(host.nodeId, host.childIds[0] ?? null, "right"),
    endAnchor: childBoundary(host.nodeId, null, "left"),
    runs,
    inlineRanges,
    textRunCount,
    boundaryCount: runs.length - textRunCount,
  };
}

export function textOffsetToSourceAnchor(map, offset, affinity = "right") {
  assertMap(map);
  assertTextOffset(map, offset);
  assertAffinity(affinity);

  const containingText = map.runs.find((run) => (
    run.kind === "text"
    && offset > run.textStart
    && offset < run.textEnd
  ));
  if (containingText) {
    const utf16Offset = offset - containingText.textStart;
    assertTextBoundary(containingText, utf16Offset);
    return textAnchor(containingText.textNodeId, utf16Offset, affinity);
  }

  const leftRun = [...map.runs].reverse().find((run) => run.textEnd === offset);
  const rightRun = map.runs.find((run) => run.textStart === offset);
  const leftAnchor = leftRun ? anchorAtEnd(leftRun) : map.startAnchor;
  const rightAnchor = rightRun ? anchorAtStart(rightRun) : map.endAnchor;
  return withAffinity(affinity === "left" ? leftAnchor : rightAnchor, affinity);
}

export function sourceAnchorToTextOffset(map, anchor) {
  assertMap(map);
  assertAffinity(anchor?.affinity ?? "right");
  if (anchor?.kind === "text") {
    const run = map.runs.find(
      (candidate) => candidate.kind === "text"
        && candidate.textNodeId === anchor.textNodeId,
    );
    if (!run) {
      fail(
        "SOURCE_TEXT_NODE_OUTSIDE_MAP",
        "The source text anchor is outside this text map.",
        { textNodeId: anchor.textNodeId },
      );
    }
    assertTextBoundary(run, anchor.utf16Offset);
    return run.textStart + anchor.utf16Offset;
  }
  if (anchor?.kind !== "child-boundary") {
    fail("INVALID_SOURCE_ANCHOR", "A valid source anchor is required.");
  }

  const matches = (candidate) => candidate?.kind === "child-boundary"
    && candidate.parentNodeId === anchor.parentNodeId
    && candidate.beforeNodeId === anchor.beforeNodeId;
  if (matches(map.startAnchor)) return 0;
  if (matches(map.endAnchor)) return map.textLength;
  for (const run of map.runs) {
    if (matches(run.beforeAnchor)) return run.textStart;
    if (matches(run.afterAnchor)) return run.textEnd;
  }
  fail(
    "SOURCE_CHILD_BOUNDARY_OUTSIDE_MAP",
    "The source child boundary is outside this text map.",
    { parentNodeId: anchor.parentNodeId, beforeNodeId: anchor.beforeNodeId },
  );
}

export function textRangeToSourceSegments(map, startOffset, endOffset) {
  assertMap(map);
  assertTextRange(map, startOffset, endOffset);
  if (startOffset === endOffset) return [];

  const crossedBoundary = map.runs.find((run) => (
    run.kind !== "text"
    && startOffset < run.textEnd
    && endOffset > run.textStart
  ));
  if (crossedBoundary) {
    fail(
      "SOURCE_STRUCTURE_BOUNDARY_CROSSED",
      "The text range crosses source structure that needs a structural command.",
      { kind: crossedBoundary.kind, nodeId: crossedBoundary.nodeId },
    );
  }

  const segments = [];
  for (const run of map.runs) {
    if (run.kind !== "text") continue;
    const overlapStart = Math.max(startOffset, run.textStart);
    const overlapEnd = Math.min(endOffset, run.textEnd);
    if (overlapEnd <= overlapStart) continue;
    const segmentStart = overlapStart - run.textStart;
    const segmentEnd = overlapEnd - run.textStart;
    assertTextBoundary(run, segmentStart);
    assertTextBoundary(run, segmentEnd);
    segments.push({
      textNodeId: run.textNodeId,
      startOffset: segmentStart,
      endOffset: segmentEnd,
    });
  }
  if (segments.length === 0) {
    fail(
      "NO_SOURCE_TEXT_IN_RANGE",
      "The range does not contain source-backed text.",
      { startOffset, endOffset },
    );
  }
  return segments;
}

function sameSegments(left, right) {
  return left.length === right.length && left.every((segment, index) => (
    segment.textNodeId === right[index].textNodeId
    && segment.startOffset === right[index].startOffset
    && segment.endOffset === right[index].endOffset
  ));
}

export function sourceSegmentsToTextRange(map, segments) {
  assertMap(map);
  if (!Array.isArray(segments) || segments.length === 0) {
    fail(
      "INVALID_SOURCE_TEXT_SEGMENTS",
      "At least one non-empty source text segment is required.",
    );
  }
  const ranges = segments.map((segment) => {
    const run = map.runs.find((candidate) => (
      candidate.kind === "text" && candidate.textNodeId === segment?.textNodeId
    ));
    if (!run) {
      fail(
        "SOURCE_TEXT_NODE_OUTSIDE_MAP",
        "A source text segment is outside this text map.",
        { textNodeId: segment?.textNodeId },
      );
    }
    assertTextBoundary(run, segment.startOffset);
    assertTextBoundary(run, segment.endOffset);
    if (segment.endOffset <= segment.startOffset) {
      fail(
        "INVALID_SOURCE_TEXT_SEGMENT",
        "Source text segments must be non-empty.",
        segment,
      );
    }
    return {
      startOffset: run.textStart + segment.startOffset,
      endOffset: run.textStart + segment.endOffset,
    };
  });
  const startOffset = ranges[0].startOffset;
  const endOffset = ranges.at(-1).endOffset;
  const canonical = textRangeToSourceSegments(map, startOffset, endOffset);
  if (!sameSegments(canonical, segments)) {
    fail(
      "NON_CONTIGUOUS_SOURCE_TEXT_SEGMENTS",
      "Source text segments must describe one contiguous text range.",
      { startOffset, endOffset },
    );
  }
  return { startOffset, endOffset };
}

export function isTransparentSourceTextElement(tagName) {
  return TRANSPARENT_TEXT_ELEMENTS.has(String(tagName ?? "").toLowerCase());
}
