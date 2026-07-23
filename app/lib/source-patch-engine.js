import {
  buildSourceIndex,
  compareParseIntegrity,
  sourceSha256,
} from "./source-index.js";
import { decodeHTML } from "entities";
import {
  isTransparentSourceTextElement,
} from "./source-text-map.js";
import { isNativeDirectEditRoot } from "./native-edit-capability.js";
import { isDisposableNativeInlineWrapperTag } from "./native-edit-policy.js";
import {
  cleanTargetRef,
  createInsertionPointTargetRef,
  createTargetRef,
  resolveTargetRef,
} from "./target-resolver.js";

const RAW_TEXT_ELEMENTS = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
]);

const TEXT_RANGE_UNSAFE_CONTEXT_ELEMENTS = new Set([
  ...RAW_TEXT_ELEMENTS,
  "col",
  "colgroup",
  "option",
  "optgroup",
  "select",
  "table",
  "tbody",
  "textarea",
  "tfoot",
  "thead",
  "title",
  "tr",
]);

const TEXT_INSERTION_AFFINITIES = new Set(["left", "right"]);
const SPLIT_TEXT_BLOCK_TAGS = new Set(["p", "li"]);
const SPLIT_TEXT_BLOCK_PARENTS = new Set(["ul", "ol"]);
const SPLIT_TEXT_BLOCK_OMITTED_ATTRIBUTES = new Set([
  "id",
  "name",
  "value",
  "for",
  "form",
  "itemid",
  "itemref",
  "slot",
  "popovertarget",
]);

const TRUSTED_INVERSE_PLANS = new WeakMap();
const CSS_PROPERTY_NAME_PATTERN = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/;
// `display: contents` looks geometry-neutral but Chromium can mutate a
// cross-wrapper Selection without dispatching beforeinput/input to the owning
// contenteditable host. A normal inline box keeps the native editing event
// pipeline intact. `all: unset` preserves inherited text properties while
// clearing box metrics; callers already reject flex/grid item and visible
// background cases where a new inline box would not be layout-safe.
const TEXT_RANGE_LAYOUT_GUARD = "all: unset; display: inline !important";
export function isDisposableSourceTextWrapper(element) {
  return Boolean(
    element?.type === "element"
    && element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && isTransparentSourceTextElement(element.tagName)
    && isDisposableNativeInlineWrapperTag(element.tagName)
    && element.attributes.every((attribute) => attribute.name === "style")
    && element.explicitEndTag
    && !element.isVoid
    && element.boundarySafe
  );
}
export function supportsTextRangeEditing(tagName) {
  return isNativeDirectEditRoot(tagName);
}

export class SourcePatchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourcePatchError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SourcePatchError(code, message, details);
}

function expectedHash(command, index) {
  const expected = command.expectedSourceSha256 ?? index.sourceSha256;
  if (expected !== index.sourceSha256) {
    fail(
      "STALE_SOURCE_HASH",
      "The source changed after this edit command was created.",
      { expectedSourceSha256: expected, actualSourceSha256: index.sourceSha256 },
    );
  }
  return expected;
}

function commandTargetRef(index, command, key = "targetRef") {
  const targetRef = command[key];
  if (targetRef) return cleanTargetRef(targetRef);
  const nodeId = key === "targetRef" ? command.nodeId : command.beforeNodeId;
  if (!nodeId) {
    fail("TARGET_REQUIRED", `Edit command is missing ${key}.`);
  }
  return createTargetRef(index, nodeId, {
    level: key === "targetRef" ? command.level : "subregion",
  });
}

function resolvedTarget(index, targetRef, expectedType = null) {
  const resolution = resolveTargetRef(index, targetRef);
  if (resolution.resolution === "ambiguous") {
    fail(
      "TARGET_AMBIGUOUS",
      "The edit target matches more than one source node.",
      { targetRef, candidates: resolution.candidates },
    );
  }
  if (!resolution.target || resolution.resolution === "orphaned") {
    fail(
      "TARGET_ORPHANED",
      "The edit target no longer exists in the current source.",
      { targetRef },
    );
  }
  if (expectedType && resolution.target.type !== expectedType) {
    fail(
      "UNSUPPORTED_TARGET_TYPE",
      `This edit requires a ${expectedType} target.`,
      { actualType: resolution.target.type },
    );
  }
  return resolution;
}

function refreshResolvedTargetRef(index, targetRef, target) {
  return createTargetRef(index, target, {
    targetId: targetRef.targetId,
    label: targetRef.label,
    level: targetRef.level,
    selector: target.selector,
  });
}

function sourcePatch(startOffset, endOffset, before, after, metadata = {}) {
  return {
    startOffset,
    endOffset,
    before,
    after,
    ...metadata,
  };
}

function makePlan(index, command, patches, targetRefs, metadata = {}) {
  const ordered = [...patches].sort((left, right) => left.startOffset - right.startOffset);
  let previousEnd = -1;
  for (const patch of ordered) {
    if (
      !Number.isInteger(patch.startOffset)
      || !Number.isInteger(patch.endOffset)
      || patch.startOffset < 0
      || patch.endOffset < patch.startOffset
      || patch.endOffset > index.source.length
    ) {
      fail("INVALID_PATCH_RANGE", "Patch range is outside the source.", { patch });
    }
    if (patch.startOffset < previousEnd) {
      fail("OVERLAPPING_PATCHES", "Patch ranges overlap.", { patches: ordered });
    }
    if (index.source.slice(patch.startOffset, patch.endOffset) !== patch.before) {
      fail("STALE_BEFORE_CONTENT", "Patch before-content no longer matches the source.", { patch });
    }
    previousEnd = patch.endOffset;
  }
  return {
    version: 1,
    type: command.type,
    sourceSha256: expectedHash(command, index),
    patches: ordered,
    targetRefs,
    metadata,
  };
}

function escapeTextContent(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function escapeTextFlowContent(value) {
  return String(value)
    .split("\n")
    .map((line) => escapeTextContent(line))
    .join("<br>");
}

function omitAttributeFromSplitClone(attribute) {
  const name = String(attribute?.name ?? "").toLowerCase();
  return SPLIT_TEXT_BLOCK_OMITTED_ATTRIBUTES.has(name)
    || name.startsWith("on")
    || /^data-(?:.*-)?(?:id|key|uid|uuid)$/u.test(name);
}

function splitCloneStartTag(index, element) {
  const omitted = element.attributes
    .filter(omitAttributeFromSplitClone)
    .map((attribute) => attribute.range)
    .sort((left, right) => left.startOffset - right.startOffset);
  let cursor = element.startTagRange.startOffset;
  let cloned = "";
  for (const attributeRange of omitted) {
    cloned += index.source.slice(cursor, attributeRange.startOffset);
    cursor = attributeRange.endOffset;
  }
  cloned += index.source.slice(cursor, element.startTagRange.endOffset);
  return cloned;
}

function isDescendantNode(index, node, ancestor) {
  let current = node;
  while (current?.parentId) {
    if (current.parentId === ancestor.nodeId) return true;
    current = index.byNodeId.get(current.parentId);
  }
  return false;
}

function htmlEntityToken(raw, startOffset) {
  if (raw[startOffset] !== "&") return null;
  const tokenLimit = Math.min(raw.length, startOffset + 36);
  let semicolonOffset = -1;
  for (let cursor = startOffset + 1; cursor < tokenLimit; cursor += 1) {
    const character = raw[cursor];
    if (character === ";") {
      semicolonOffset = cursor;
      break;
    }
    if (/\s|<|&/.test(character)) break;
  }
  if (semicolonOffset >= 0) {
    const source = raw.slice(startOffset, semicolonOffset + 1);
    const decoded = decodeHTML(source);
    if (decoded !== source) {
      return { rawLength: source.length, decoded };
    }
  }

  for (let cursor = startOffset + 2; cursor <= tokenLimit; cursor += 1) {
    const source = raw.slice(startOffset, cursor);
    const decoded = decodeHTML(source);
    if (decoded !== source) {
      return { rawLength: source.length, decoded };
    }
    const next = raw[cursor];
    if (!next || /\s|<|&|;/.test(next)) break;
  }
  return null;
}

function decodedBoundaryMap(raw, expectedValue) {
  const boundaries = new Map([[0, 0]]);
  let rawOffset = 0;
  let decodedOffset = 0;
  let decodedValue = "";
  while (rawOffset < raw.length) {
    const entity = htmlEntityToken(raw, rawOffset);
    if (entity) {
      rawOffset += entity.rawLength;
      decodedOffset += entity.decoded.length;
      decodedValue += entity.decoded;
      boundaries.set(decodedOffset, rawOffset);
      continue;
    }
    if (raw[rawOffset] === "\r") {
      rawOffset += raw[rawOffset + 1] === "\n" ? 2 : 1;
      decodedOffset += 1;
      decodedValue += "\n";
      boundaries.set(decodedOffset, rawOffset);
      continue;
    }
    const codePoint = raw.codePointAt(rawOffset);
    const sourceLength = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    decodedValue += raw.slice(rawOffset, rawOffset + sourceLength);
    rawOffset += sourceLength;
    decodedOffset += sourceLength;
    boundaries.set(decodedOffset, rawOffset);
  }
  if (expectedValue !== undefined && decodedValue !== expectedValue) {
    fail(
      "UNSAFE_TEXT_RANGE_MAPPING",
      "Selected text cannot be mapped back to its exact source encoding.",
      { expectedValue, decodedValue },
    );
  }
  return boundaries;
}

function rawBoundaryForTextOffset(textNode, decodedOffset) {
  if (
    !Number.isInteger(decodedOffset)
    || decodedOffset < 0
    || decodedOffset > textNode.value.length
  ) {
    fail(
      "INVALID_TEXT_RANGE",
      "Selected text range is outside the source text node.",
      { textNodeId: textNode.nodeId, decodedOffset },
    );
  }
  const rawOffset = decodedBoundaryMap(textNode.raw, textNode.value).get(decodedOffset);
  if (rawOffset === undefined) {
    fail(
      "UNSAFE_TEXT_RANGE_BOUNDARY",
      "Selected text begins or ends inside an encoded character.",
      { textNodeId: textNode.nodeId, decodedOffset },
    );
  }
  return textNode.range.startOffset + rawOffset;
}

function assertTextRangeStyleContext(index, textNode, target) {
  let ancestorId = textNode.parentId;
  while (ancestorId) {
    const ancestor = index.byNodeId.get(ancestorId);
    if (!ancestor || ancestor.type !== "element") {
      fail(
        "TEXT_RANGE_UNSAFE_CONTEXT",
        "Selected text does not have a stable HTML element context.",
        { textNodeId: textNode.nodeId, ancestorId },
      );
    }
    if (
      ancestor.namespaceURI !== "http://www.w3.org/1999/xhtml"
      || TEXT_RANGE_UNSAFE_CONTEXT_ELEMENTS.has(ancestor.tagName)
    ) {
      fail(
        "TEXT_RANGE_UNSAFE_CONTEXT",
        `Partial text styling is unsafe inside <${ancestor.tagName}>.`,
        {
          textNodeId: textNode.nodeId,
          ancestorId: ancestor.nodeId,
          tagName: ancestor.tagName,
          namespaceURI: ancestor.namespaceURI,
        },
      );
    }
    if (ancestor.nodeId === target.nodeId) return;
    ancestorId = ancestor.parentId;
  }
  fail(
    "TEXT_RANGE_TARGET_MISMATCH",
    "Selected text no longer belongs to the authorized source element.",
    { textNodeId: textNode.nodeId, targetId: target.nodeId },
  );
}

function normalizedTextRangeSegments(index, target, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    fail("TEXT_RANGE_REQUIRED", "Text range style command has no selected text.");
  }
  if (!supportsTextRangeEditing(target.tagName)) {
    fail(
      "TEXT_RANGE_STYLE_UNSUPPORTED",
      `Partial text styling is not supported inside <${target.tagName}>.`,
      { nodeId: target.nodeId },
    );
  }
  const normalized = segments.map((segment) => {
    const textNode = index.byNodeId.get(String(segment?.textNodeId || ""));
    if (
      !textNode
      || textNode.type !== "text"
      || !isDescendantNode(index, textNode, target)
    ) {
      fail(
        "TEXT_RANGE_TARGET_MISMATCH",
        "Selected text no longer belongs to the authorized source element.",
        { textNodeId: segment?.textNodeId, targetId: target.nodeId },
      );
    }
    assertTextRangeStyleContext(index, textNode, target);
    const startOffset = Number(segment.startOffset);
    const endOffset = Number(segment.endOffset);
    if (
      !Number.isInteger(startOffset)
      || !Number.isInteger(endOffset)
      || startOffset < 0
      || endOffset <= startOffset
      || endOffset > textNode.value.length
    ) {
      fail(
        "INVALID_TEXT_RANGE",
        "Selected text range is empty or outside the source text node.",
        { textNodeId: textNode.nodeId, startOffset, endOffset },
      );
    }
    return {
      textNode,
      textNodeId: textNode.nodeId,
      startOffset,
      endOffset,
      rawStartOffset: rawBoundaryForTextOffset(textNode, startOffset),
      rawEndOffset: rawBoundaryForTextOffset(textNode, endOffset),
    };
  }).sort((left, right) => left.rawStartOffset - right.rawStartOffset);
  for (let indexPosition = 1; indexPosition < normalized.length; indexPosition += 1) {
    if (normalized[indexPosition].rawStartOffset <= normalized[indexPosition - 1].rawEndOffset) {
      fail(
        "OVERLAPPING_TEXT_RANGES",
        "Selected text ranges overlap or touch in the same source content.",
        {
          previous: normalized[indexPosition - 1],
          current: normalized[indexPosition],
        },
      );
    }
  }
  return normalized;
}

function isNodeInsideOrEqual(index, node, ancestor) {
  return node?.nodeId === ancestor.nodeId || isDescendantNode(index, node, ancestor);
}

function assertTextInsertionContext(index, element, target) {
  let current = element;
  while (current) {
    if (
      current.type !== "element"
      || current.namespaceURI !== "http://www.w3.org/1999/xhtml"
      || TEXT_RANGE_UNSAFE_CONTEXT_ELEMENTS.has(current.tagName)
    ) {
      fail(
        "TEXT_RANGE_UNSAFE_CONTEXT",
        "Text insertion does not have a safe HTML element context.",
        {
          nodeId: current?.nodeId,
          tagName: current?.tagName,
          namespaceURI: current?.namespaceURI,
        },
      );
    }
    if (current.nodeId === target.nodeId) return;
    current = current.parentId ? index.byNodeId.get(current.parentId) : null;
  }
  fail(
    "TEXT_RANGE_TARGET_MISMATCH",
    "Text insertion no longer belongs to the authorized source element.",
    { elementId: element?.nodeId, targetId: target.nodeId },
  );
}

function cleanInsertionAnchor(anchor) {
  if (anchor.kind === "text") {
    return {
      kind: "text",
      textNodeId: anchor.textNodeId,
      utf16Offset: anchor.utf16Offset,
      affinity: anchor.affinity,
    };
  }
  return {
    kind: "child-boundary",
    parentNodeId: anchor.parentNodeId,
    beforeNodeId: anchor.beforeNodeId,
    affinity: anchor.affinity,
  };
}

function normalizedInsertionAnchor(index, target, anchor) {
  if (!anchor || typeof anchor !== "object") {
    fail("INSERTION_ANCHOR_REQUIRED", "Text replacement is missing its insertion anchor.");
  }
  const affinity = String(anchor.affinity ?? "");
  if (!TEXT_INSERTION_AFFINITIES.has(affinity)) {
    fail(
      "INVALID_INSERTION_ANCHOR",
      "Text insertion affinity must be left or right.",
      { anchor },
    );
  }

  if (anchor.kind === "text") {
    const textNode = index.byNodeId.get(String(anchor.textNodeId ?? ""));
    if (
      !textNode
      || textNode.type !== "text"
      || !isDescendantNode(index, textNode, target)
    ) {
      fail(
        "TEXT_RANGE_TARGET_MISMATCH",
        "Text insertion anchor no longer belongs to the authorized source element.",
        { textNodeId: anchor.textNodeId, targetId: target.nodeId },
      );
    }
    assertTextRangeStyleContext(index, textNode, target);
    const utf16Offset = Number(anchor.utf16Offset);
    const rawOffset = rawBoundaryForTextOffset(textNode, utf16Offset);
    return {
      kind: "text",
      textNodeId: textNode.nodeId,
      utf16Offset,
      affinity,
      rawOffset,
    };
  }

  if (anchor.kind === "child-boundary") {
    const parent = index.byNodeId.get(String(anchor.parentNodeId ?? ""));
    if (
      !parent
      || parent.type !== "element"
      || !isNodeInsideOrEqual(index, parent, target)
    ) {
      fail(
        "TEXT_RANGE_TARGET_MISMATCH",
        "Child-boundary insertion no longer belongs to the authorized source element.",
        { parentNodeId: anchor.parentNodeId, targetId: target.nodeId },
      );
    }
    assertTextInsertionContext(index, parent, target);
    if (
      parent.nodeId !== target.nodeId
      && !isTransparentSourceTextElement(parent.tagName)
    ) {
      fail(
        "TEXT_RANGE_STRUCTURAL_BOUNDARY",
        `Text cannot be inserted directly into the structural <${parent.tagName}> child.`,
        { parentNodeId: parent.nodeId, targetId: target.nodeId },
      );
    }
    const beforeNodeId = anchor.beforeNodeId == null
      ? null
      : String(anchor.beforeNodeId);
    const beforeNode = beforeNodeId ? index.byNodeId.get(beforeNodeId) : null;
    if (
      beforeNodeId
      && (!beforeNode || beforeNode.parentId !== parent.nodeId)
    ) {
      fail(
        "INVALID_INSERTION_ANCHOR",
        "Insertion boundary sibling no longer belongs to its declared parent.",
        { parentNodeId: parent.nodeId, beforeNodeId },
      );
    }
    const rawOffset = beforeNode?.range.startOffset ?? parent.contentRange.endOffset;
    if (
      !parent.boundarySafe
      || rawOffset < parent.contentRange.startOffset
      || rawOffset > parent.contentRange.endOffset
    ) {
      fail(
        "INVALID_INSERTION_ANCHOR",
        "Insertion boundary is not a safe source child boundary.",
        { parentNodeId: parent.nodeId, beforeNodeId, rawOffset },
      );
    }
    return {
      kind: "child-boundary",
      parentNodeId: parent.nodeId,
      beforeNodeId,
      affinity,
      rawOffset,
    };
  }

  fail(
    "INVALID_INSERTION_ANCHOR",
    "Text insertion anchor must be a text or child-boundary anchor.",
    { anchor },
  );
}

function sourceTextLeafTokens(index, target) {
  const tokens = [];
  const visit = (node) => {
    if (!node) return;
    if (node.type === "text") {
      tokens.push({ kind: "text", node });
      return;
    }
    if (node.type === "comment") {
      tokens.push({ kind: "atom", node });
      return;
    }
    if (node.type !== "element") {
      tokens.push({ kind: "atom", node });
      return;
    }
    if (
      node.namespaceURI !== "http://www.w3.org/1999/xhtml"
      || node.tagName === "br"
      || node.tagName === "wbr"
      || node.isVoid
      || !isTransparentSourceTextElement(node.tagName)
    ) {
      tokens.push({ kind: node.tagName === "br" ? "hard-break" : "atom", node });
      return;
    }
    for (const childId of node.childIds) visit(index.byNodeId.get(childId));
  };
  for (const childId of target.childIds) visit(index.byNodeId.get(childId));
  return tokens;
}

function assertContinuousTextReplacement(index, target, segments) {
  if (segments.length === 0) return;
  const tokens = sourceTextLeafTokens(index, target);
  const tokenIndexByTextNodeId = new Map();
  for (let position = 0; position < tokens.length; position += 1) {
    const token = tokens[position];
    if (token.kind === "text") tokenIndexByTextNodeId.set(token.node.nodeId, position);
  }
  const segmentByTextNodeId = new Map();
  for (const segment of segments) {
    if (segmentByTextNodeId.has(segment.textNodeId)) {
      fail(
        "NON_CONTIGUOUS_TEXT_REPLACEMENT",
        "One replacement cannot contain disjoint ranges from the same text node.",
        { textNodeId: segment.textNodeId },
      );
    }
    segmentByTextNodeId.set(segment.textNodeId, segment);
  }
  const firstPosition = tokenIndexByTextNodeId.get(segments[0].textNodeId);
  const lastPosition = tokenIndexByTextNodeId.get(segments.at(-1).textNodeId);
  if (
    !Number.isInteger(firstPosition)
    || !Number.isInteger(lastPosition)
    || lastPosition < firstPosition
  ) {
    fail(
      "TEXT_RANGE_STRUCTURAL_BOUNDARY",
      "Text replacement crosses an unsupported inline structure.",
      { textNodeIds: segments.map((segment) => segment.textNodeId) },
    );
  }
  if (firstPosition === lastPosition && segments.length === 1) return;
  for (let position = firstPosition; position <= lastPosition; position += 1) {
    const token = tokens[position];
    if (token.kind !== "text") {
      fail(
        "TEXT_RANGE_STRUCTURAL_BOUNDARY",
        "Text replacement cannot cross a hard break or inline atom.",
        { kind: token.kind, nodeId: token.node?.nodeId },
      );
    }
    const segment = segmentByTextNodeId.get(token.node.nodeId);
    if (!segment) {
      fail(
        "NON_CONTIGUOUS_TEXT_REPLACEMENT",
        "Text replacement skipped source text between its selected segments.",
        { textNodeId: token.node.nodeId },
      );
    }
    const isFirst = position === firstPosition;
    const isLast = position === lastPosition;
    if (
      (!isFirst && segment.startOffset !== 0)
      || (!isLast && segment.endOffset !== token.node.value.length)
    ) {
      fail(
        "NON_CONTIGUOUS_TEXT_REPLACEMENT",
        "Text replacement segments do not describe one continuous browser selection.",
        {
          textNodeId: token.node.nodeId,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
        },
      );
    }
  }
}

function normalizedTextReplacements(index, target, command) {
  const hasReplacements = Object.hasOwn(command, "replacements");
  let inputs;
  let legacy = false;
  if (hasReplacements) {
    if (!Array.isArray(command.replacements) || command.replacements.length === 0) {
      fail(
        "TEXT_REPLACEMENTS_REQUIRED",
        "Text range edit command requires at least one replacement.",
      );
    }
    inputs = command.replacements;
  } else {
    if (!Object.hasOwn(command, "nextText")) {
      fail("NEXT_TEXT_REQUIRED", "Text range edit command is missing nextText.");
    }
    legacy = true;
    inputs = [{
      deleteSegments: command.segments,
      nextText: command.nextText,
      ...(Object.hasOwn(command, "beforeText")
        ? { beforeText: command.beforeText }
        : {}),
    }];
  }

  const replacements = inputs.map((input, replacementIndex) => {
    if (!input || typeof input !== "object" || !Object.hasOwn(input, "nextText")) {
      fail(
        "TEXT_REPLACEMENT_INVALID",
        "Every text replacement requires nextText.",
        { replacementIndex },
      );
    }
    const rawSegments = legacy ? input.deleteSegments : (input.deleteSegments ?? []);
    if (!Array.isArray(rawSegments)) {
      fail(
        "TEXT_REPLACEMENT_INVALID",
        "Text replacement deleteSegments must be an array.",
        { replacementIndex },
      );
    }
    const segments = rawSegments.length > 0
      ? normalizedTextRangeSegments(index, target, rawSegments)
      : [];
    assertContinuousTextReplacement(index, target, segments);
    const derivedLegacyAnchor = legacy && segments.length > 0
      ? {
          kind: "text",
          textNodeId: segments[0].textNodeId,
          utf16Offset: segments[0].startOffset,
          affinity: "right",
        }
      : null;
    const insertAt = normalizedInsertionAnchor(
      index,
      target,
      input.insertAt ?? derivedLegacyAnchor,
    );
    const beforeText = segments.map((segment) => (
      segment.textNode.value.slice(segment.startOffset, segment.endOffset)
    )).join("");
    if (
      Object.hasOwn(input, "beforeText")
      && String(input.beforeText) !== beforeText
    ) {
      fail(
        "STALE_BEFORE_CONTENT",
        "The selected text changed after the replacement was created.",
        { replacementIndex, expected: input.beforeText, actual: beforeText },
      );
    }
    return {
      replacementIndex,
      segments,
      insertAt,
      beforeText,
      nextText: String(input.nextText),
    };
  });

  const combinedBeforeText = replacements.map((replacement) => replacement.beforeText).join("");
  if (
    hasReplacements
    && Object.hasOwn(command, "beforeText")
    && String(command.beforeText) !== combinedBeforeText
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "The replacement source text changed after the edit began.",
      { expected: command.beforeText, actual: combinedBeforeText },
    );
  }

  for (let leftIndex = 0; leftIndex < replacements.length; leftIndex += 1) {
    const left = replacements[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < replacements.length; rightIndex += 1) {
      const right = replacements[rightIndex];
      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          if (
            leftSegment.rawStartOffset < rightSegment.rawEndOffset
            && rightSegment.rawStartOffset < leftSegment.rawEndOffset
          ) {
            fail(
              "OVERLAPPING_TEXT_REPLACEMENTS",
              "Text replacements contain overlapping deletion ranges.",
              { leftIndex, rightIndex },
            );
          }
        }
        if (
          right.insertAt.rawOffset >= leftSegment.rawStartOffset
          && right.insertAt.rawOffset <= leftSegment.rawEndOffset
        ) {
          fail(
            "OVERLAPPING_TEXT_REPLACEMENTS",
            "A text insertion overlaps another replacement deletion.",
            { leftIndex, rightIndex },
          );
        }
      }
      for (const rightSegment of right.segments) {
        if (
          left.insertAt.rawOffset >= rightSegment.rawStartOffset
          && left.insertAt.rawOffset <= rightSegment.rawEndOffset
        ) {
          fail(
            "OVERLAPPING_TEXT_REPLACEMENTS",
            "A text insertion overlaps another replacement deletion.",
            { leftIndex, rightIndex },
          );
        }
      }
      if (left.insertAt.rawOffset === right.insertAt.rawOffset) {
        fail(
          "OVERLAPPING_TEXT_REPLACEMENTS",
          "Two text replacements cannot insert at the same source boundary.",
          { leftIndex, rightIndex },
        );
      }
    }
  }

  return { replacements, legacy, combinedBeforeText };
}

function fullyDeletedTextNode(textNode, segmentsByTextNodeId) {
  const segments = [...(segmentsByTextNodeId.get(textNode.nodeId) ?? [])]
    .sort((left, right) => left.startOffset - right.startOffset);
  if (segments.length === 0) return false;
  let coveredUntil = 0;
  for (const segment of segments) {
    if (segment.startOffset > coveredUntil) return false;
    coveredUntil = Math.max(coveredUntil, segment.endOffset);
  }
  return coveredUntil === textNode.value.length;
}

function insertionAnchorIsInside(index, anchor, element) {
  const anchorNode = anchor.kind === "text"
    ? index.byNodeId.get(anchor.textNodeId)
    : index.byNodeId.get(anchor.parentNodeId);
  return isNodeInsideOrEqual(index, anchorNode, element);
}

function emptyTransparentWrappersForReplacement(index, target, replacements) {
  const segmentsByTextNodeId = new Map();
  for (const replacement of replacements) {
    for (const segment of replacement.segments) {
      const segments = segmentsByTextNodeId.get(segment.textNodeId) ?? [];
      segments.push(segment);
      segmentsByTextNodeId.set(segment.textNodeId, segments);
    }
  }

  const analysisByNodeId = new Map();
  const analyze = (element) => {
    if (analysisByNodeId.has(element.nodeId)) {
      return analysisByNodeId.get(element.nodeId);
    }
    const analysis = {
      transparent: isDisposableSourceTextWrapper(element),
      allTextDeleted: true,
      hasDeletion: false,
    };
    analysisByNodeId.set(element.nodeId, analysis);
    if (!analysis.transparent) return analysis;

    let nextSourceOffset = element.contentRange.startOffset;
    for (const childId of element.childIds) {
      const child = index.byNodeId.get(childId);
      if (
        !child
        || child.range.startOffset !== nextSourceOffset
        || child.range.endOffset < child.range.startOffset
      ) {
        analysis.transparent = false;
        return analysis;
      }
      nextSourceOffset = child.range.endOffset;
      if (child.type === "text") {
        const segments = segmentsByTextNodeId.get(child.nodeId) ?? [];
        analysis.hasDeletion ||= segments.length > 0;
        analysis.allTextDeleted &&= fullyDeletedTextNode(
          child,
          segmentsByTextNodeId,
        );
        continue;
      }
      if (child.type !== "element" || !isTransparentSourceTextElement(child.tagName)) {
        analysis.transparent = false;
        return analysis;
      }
      const childAnalysis = analyze(child);
      analysis.transparent &&= childAnalysis.transparent;
      analysis.allTextDeleted &&= childAnalysis.allTextDeleted;
      analysis.hasDeletion ||= childAnalysis.hasDeletion;
      if (!analysis.transparent) return analysis;
    }
    if (nextSourceOffset !== element.contentRange.endOffset) {
      analysis.transparent = false;
    }
    return analysis;
  };

  const candidates = [];
  for (const element of index.elements) {
    if (
      element.nodeId === target.nodeId
      || !isDescendantNode(index, element, target)
    ) {
      continue;
    }
    const analysis = analyze(element);
    if (
      !analysis.transparent
      || !analysis.allTextDeleted
      || !analysis.hasDeletion
      || replacements.some((replacement) => (
        replacement.nextText !== ""
        && insertionAnchorIsInside(index, replacement.insertAt, element)
      ))
    ) {
      continue;
    }
    candidates.push(element);
  }

  const candidateIds = new Set(candidates.map((element) => element.nodeId));
  return candidates.filter((element) => {
    let ancestorId = element.parentId;
    while (ancestorId && ancestorId !== target.nodeId) {
      if (candidateIds.has(ancestorId)) return false;
      ancestorId = index.byNodeId.get(ancestorId)?.parentId ?? null;
    }
    return true;
  }).sort((left, right) => left.range.startOffset - right.range.startOffset);
}

function pureTextTarget(index, targetRef) {
  const resolution = resolvedTarget(index, targetRef);
  let textNode = resolution.target;
  let parent = null;
  if (textNode.type === "element") {
    parent = textNode;
    const children = parent.childIds.map((nodeId) => index.byNodeId.get(nodeId));
    if (children.length !== 1 || children[0].type !== "text") {
      fail(
        "MIXED_TEXT_CONTENT",
        "Direct text editing supports exactly one text node and no mixed child elements.",
        { nodeId: parent.nodeId, childTypes: children.map((child) => child.type) },
      );
    }
    textNode = children[0];
  } else if (textNode.type === "text") {
    parent = textNode.parentId ? index.byNodeId.get(textNode.parentId) : null;
    const children = parent?.childIds.map((nodeId) => index.byNodeId.get(nodeId)) ?? [];
    if (!parent || children.length !== 1 || children[0].nodeId !== textNode.nodeId) {
      fail(
        "MIXED_TEXT_CONTENT",
        "Direct text editing supports exactly one text node and no mixed child elements.",
        { nodeId: textNode.nodeId },
      );
    }
  } else {
    fail("UNSUPPORTED_TARGET_TYPE", "Text edits require an element or text target.");
  }
  if (RAW_TEXT_ELEMENTS.has(parent.tagName)) {
    fail(
      "RAW_TEXT_EDIT_UNSUPPORTED",
      `Direct text editing is disabled for <${parent.tagName}>.`,
      { nodeId: parent.nodeId },
    );
  }
  return { resolution, parent, textNode };
}

export function planTextPatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const { resolution, parent, textNode } = pureTextTarget(index, targetRef);
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    resolution.target,
  );
  if (
    Object.hasOwn(command, "beforeText")
    && command.beforeText !== textNode.value
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "The text changed after the edit began.",
      { expected: command.beforeText, actual: textNode.value },
    );
  }
  if (
    Object.hasOwn(command, "beforeSource")
    && command.beforeSource !== textNode.raw
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "The exact source text changed after the edit began.",
      { expected: command.beforeSource, actual: textNode.raw },
    );
  }
  if (!Object.hasOwn(command, "nextText")) {
    fail("NEXT_TEXT_REQUIRED", "Text edit command is missing nextText.");
  }
  const nextSourceText = escapeTextContent(command.nextText);
  const patch = sourcePatch(
    textNode.range.startOffset,
    textNode.range.endOffset,
    textNode.raw,
    nextSourceText,
    { kind: "text", nodeId: textNode.nodeId },
  );
  return makePlan(
    index,
    { ...command, type: "replace-text" },
    nextSourceText === textNode.raw ? [] : [patch],
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      parentNodeId: parent.nodeId,
      beforeText: textNode.value,
      nextText: String(command.nextText),
    },
  );
}

function planTextRangeLikePatch(indexOrHtml, command, options) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const target = resolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    target,
  );
  if (!supportsTextRangeEditing(target.tagName)) {
    fail(
      "TEXT_RANGE_STYLE_UNSUPPORTED",
      `Partial text editing is not supported inside <${target.tagName}>.`,
      { nodeId: target.nodeId },
    );
  }
  const {
    replacements,
    legacy,
    combinedBeforeText,
  } = normalizedTextReplacements(index, target, command);
  const patches = [];
  for (const replacement of replacements) {
    const escapedNextText = options.encodeNextText(replacement.nextText);
    let insertionOwner = null;
    if (replacement.insertAt.kind === "text") {
      insertionOwner = replacement.segments.find((segment) => (
        segment.textNodeId === replacement.insertAt.textNodeId
        && replacement.insertAt.utf16Offset >= segment.startOffset
        && replacement.insertAt.utf16Offset <= segment.endOffset
      )) ?? null;
    }
    if (!insertionOwner) {
      const boundarySegments = replacement.segments.filter((segment) => (
        replacement.insertAt.rawOffset === segment.rawStartOffset
        || replacement.insertAt.rawOffset === segment.rawEndOffset
      ));
      insertionOwner = replacement.insertAt.affinity === "left"
        ? boundarySegments.at(-1) ?? null
        : boundarySegments[0] ?? null;
    }

    for (const segment of replacement.segments) {
      const before = index.source.slice(
        segment.rawStartOffset,
        segment.rawEndOffset,
      );
      const after = segment === insertionOwner ? escapedNextText : "";
      if (before === after) continue;
      patches.push(sourcePatch(
        segment.rawStartOffset,
        segment.rawEndOffset,
        before,
        after,
        {
          kind: options.patchKind,
          nodeId: segment.textNodeId,
          replacementIndex: replacement.replacementIndex,
        },
      ));
    }
    if (!insertionOwner && escapedNextText) {
      patches.push(sourcePatch(
        replacement.insertAt.rawOffset,
        replacement.insertAt.rawOffset,
        "",
        escapedNextText,
        {
          kind: options.patchKind,
          nodeId: replacement.insertAt.textNodeId
            ?? replacement.insertAt.parentNodeId,
          replacementIndex: replacement.replacementIndex,
        },
      ));
    }
  }

  const emptyWrappers = emptyTransparentWrappersForReplacement(
    index,
    target,
    replacements,
  );
  const textPatchesOutsideEmptyWrappers = patches.filter((patch) => (
    patch.startOffset === patch.endOffset
    || !emptyWrappers.some((element) => (
      patch.startOffset >= element.range.startOffset
      && patch.endOffset <= element.range.endOffset
    ))
  ));
  for (const element of emptyWrappers) {
    const boundaryInsertionIndex = textPatchesOutsideEmptyWrappers.findIndex((patch) => (
      patch.startOffset === element.range.startOffset
      && patch.endOffset === patch.startOffset
      && patch.after !== ""
    ));
    const boundaryInsertion = boundaryInsertionIndex >= 0
      ? textPatchesOutsideEmptyWrappers.splice(boundaryInsertionIndex, 1)[0]
      : null;
    textPatchesOutsideEmptyWrappers.push(sourcePatch(
      element.range.startOffset,
      element.range.endOffset,
      element.raw,
      boundaryInsertion?.after ?? "",
      {
        kind: options.patchKind,
        nodeId: element.nodeId,
        cleanup: "empty-transparent-wrapper",
        ...(boundaryInsertion?.replacementIndex !== undefined
          ? { replacementIndex: boundaryInsertion.replacementIndex }
          : {}),
      },
    ));
  }

  const metadataReplacements = replacements.map((replacement) => ({
    deleteSegments: replacement.segments.map((segment) => ({
      textNodeId: segment.textNodeId,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
    })),
    insertAt: cleanInsertionAnchor(replacement.insertAt),
    beforeText: replacement.beforeText,
    nextText: replacement.nextText,
  }));

  return makePlan(
    index,
    { ...command, type: options.planType },
    textPatchesOutsideEmptyWrappers,
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: target.nodeId,
      beforeText: combinedBeforeText,
      replacements: metadataReplacements,
      ...(legacy
        ? {
            nextText: metadataReplacements[0].nextText,
            segments: metadataReplacements[0].deleteSegments,
          }
        : {}),
      writeScope: options.writeScope,
    },
  );
}

export function planTextRangePatch(indexOrHtml, command) {
  return planTextRangeLikePatch(indexOrHtml, command, {
    planType: "replace-text-range",
    patchKind: "text-range",
    encodeNextText: escapeTextContent,
    writeScope: "selected-text-ranges",
  });
}

export function planTextFlowRangePatch(indexOrHtml, command) {
  const inputs = Array.isArray(command?.replacements)
    ? command.replacements
    : [command];
  const nextTexts = inputs
    .filter((input) => input && Object.hasOwn(input, "nextText"))
    .map((input) => String(input.nextText));
  if (nextTexts.some((value) => value.includes("\r"))) {
    fail(
      "TEXT_FLOW_NOT_NORMALIZED",
      "Text flow line endings must be normalized before planning.",
    );
  }
  if (!nextTexts.some((value) => value.includes("\n"))) {
    fail(
      "TEXT_FLOW_BREAK_REQUIRED",
      "Text flow replacement requires at least one explicit hard break.",
    );
  }
  return planTextRangeLikePatch(indexOrHtml, command, {
    planType: "replace-text-flow-range",
    patchKind: "text-flow",
    encodeNextText: escapeTextFlowContent,
    writeScope: "selected-text-ranges-and-generated-hard-breaks",
  });
}

export function planDeleteHardBreakPatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const target = resolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    target,
  );
  if (!supportsTextRangeEditing(target.tagName)) {
    fail(
      "TEXT_RANGE_STYLE_UNSUPPORTED",
      `Hard-break editing is not supported inside <${target.tagName}>.`,
      { nodeId: target.nodeId },
    );
  }
  const hardBreak = index.byNodeId.get(String(command.hardBreakNodeId ?? ""));
  if (
    !hardBreak
    || hardBreak.type !== "element"
    || hardBreak.tagName !== "br"
    || hardBreak.namespaceURI !== "http://www.w3.org/1999/xhtml"
    || !isDescendantNode(index, hardBreak, target)
  ) {
    fail(
      "HARD_BREAK_TARGET_INVALID",
      "The declared hard break no longer belongs to the editable source element.",
      { hardBreakNodeId: command.hardBreakNodeId, targetId: target.nodeId },
    );
  }
  const patch = sourcePatch(
    hardBreak.range.startOffset,
    hardBreak.range.endOffset,
    hardBreak.raw,
    "",
    {
      kind: "hard-break",
      nodeId: hardBreak.nodeId,
    },
  );
  return makePlan(
    index,
    { ...command, type: "delete-hard-break" },
    [patch],
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: target.nodeId,
      hardBreakNodeId: hardBreak.nodeId,
      hardBreakSource: hardBreak.raw,
      writeScope: "one-authored-hard-break",
    },
  );
}

export function planSplitTextBlockPatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const target = resolution.target;
  const parent = target.parentId ? index.byNodeId.get(target.parentId) : null;
  if (
    target.namespaceURI !== "http://www.w3.org/1999/xhtml"
    || !SPLIT_TEXT_BLOCK_TAGS.has(target.tagName)
    || !target.explicitEndTag
    || target.isVoid
    || !target.boundarySafe
    || (
      target.tagName === "li"
      && (
        parent?.type !== "element"
        || !SPLIT_TEXT_BLOCK_PARENTS.has(parent.tagName)
      )
    )
  ) {
    fail(
      "BLOCK_SPLIT_UNSUPPORTED",
      "Only explicit simple <p> blocks and <li> items inside <ul>/<ol> can be split.",
      { nodeId: target.nodeId, tagName: target.tagName },
    );
  }
  if (target.childIds.length !== 1) {
    fail(
      "BLOCK_SPLIT_COMPLEX_CONTENT",
      "The block contains inline or structural children and needs a dedicated structural editor.",
      { nodeId: target.nodeId, childCount: target.childIds.length },
    );
  }
  const textNode = index.byNodeId.get(target.childIds[0]);
  if (
    !textNode
    || textNode.type !== "text"
    || textNode.parentId !== target.nodeId
  ) {
    fail(
      "BLOCK_SPLIT_COMPLEX_CONTENT",
      "The block is not backed by one direct source text node.",
      { nodeId: target.nodeId },
    );
  }
  const splitOffset = Number(command.splitOffset);
  if (
    !Number.isInteger(splitOffset)
    || splitOffset <= 0
    || splitOffset >= textNode.value.length
  ) {
    fail(
      "BLOCK_SPLIT_BOUNDARY_UNSUPPORTED",
      "The caret must be inside non-empty text so both resulting blocks remain editable.",
      { splitOffset, textLength: textNode.value.length },
    );
  }
  const rawSplitOffset = rawBoundaryForTextOffset(textNode, splitOffset);
  const clonedStartTag = splitCloneStartTag(index, target);
  const insertedSource = `${target.endTagRaw}${clonedStartTag}`;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    target,
  );
  const patch = sourcePatch(
    rawSplitOffset,
    rawSplitOffset,
    "",
    insertedSource,
    {
      kind: "block-split",
      nodeId: target.nodeId,
    },
  );
  return makePlan(
    index,
    { ...command, type: "split-text-block" },
    [patch],
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: target.nodeId,
      tagName: target.tagName,
      splitOffset,
      rawSplitOffset,
      beforeText: textNode.value,
      firstText: textNode.value.slice(0, splitOffset),
      secondText: textNode.value.slice(splitOffset),
      clonedStartTag,
      createdBlockStartOffset: rawSplitOffset + target.endTagRaw.length,
      writeScope: "one-simple-text-block-boundary",
    },
  );
}

function normalizePropertyName(property) {
  const value = String(property ?? "").trim();
  if (!CSS_PROPERTY_NAME_PATTERN.test(value)) {
    fail("INVALID_STYLE_PROPERTY", "Inline style property name is invalid.", { property });
  }
  return value.startsWith("--") ? value : value.toLowerCase();
}

function topLevelColon(raw) {
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    else if (char === ":" && depth === 0) return index;
  }
  return -1;
}

function declarationSegments(raw) {
  const segments = [];
  let startOffset = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (index === raw.length || (char === ";" && !quote && !comment && depth === 0)) {
      segments.push({
        startOffset,
        endOffset: index,
        separatorEndOffset: index < raw.length ? index + 1 : index,
        raw: raw.slice(startOffset, index),
      });
      startOffset = index + 1;
      continue;
    }
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
  }
  return segments;
}

function trimBounds(raw, startOffset, endOffset) {
  while (startOffset < endOffset && /\s/.test(raw[startOffset])) startOffset += 1;
  while (endOffset > startOffset && /\s/.test(raw[endOffset - 1])) endOffset -= 1;
  return { startOffset, endOffset };
}

export function parseInlineStyle(rawStyle) {
  const raw = String(rawStyle ?? "");
  const declarations = [];
  for (const segment of declarationSegments(raw)) {
    const colon = topLevelColon(segment.raw);
    if (colon < 0) continue;
    const propertyBounds = trimBounds(segment.raw, 0, colon);
    const valueBounds = trimBounds(segment.raw, colon + 1, segment.raw.length);
    const property = segment.raw.slice(propertyBounds.startOffset, propertyBounds.endOffset);
    if (!property) continue;
    const normalizedProperty = property.startsWith("--") ? property : property.toLowerCase();
    const trimmedValue = segment.raw.slice(valueBounds.startOffset, valueBounds.endOffset);
    const importantMatch = trimmedValue.match(/(\s*!\s*important)\s*$/i);
    const importantStart = importantMatch
      ? valueBounds.endOffset - importantMatch[0].length
      : valueBounds.endOffset;
    const valueCoreBounds = trimBounds(segment.raw, valueBounds.startOffset, importantStart);
    declarations.push({
      property,
      normalizedProperty,
      value: segment.raw.slice(valueCoreBounds.startOffset, valueCoreBounds.endOffset),
      important: Boolean(importantMatch),
      importantRaw: importantMatch ? segment.raw.slice(importantStart, valueBounds.endOffset) : "",
      segmentStartOffset: segment.startOffset,
      segmentEndOffset: segment.endOffset,
      separatorEndOffset: segment.separatorEndOffset,
      propertyStartOffset: segment.startOffset + propertyBounds.startOffset,
      propertyEndOffset: segment.startOffset + propertyBounds.endOffset,
      valueStartOffset: segment.startOffset + valueBounds.startOffset,
      valueEndOffset: segment.startOffset + valueBounds.endOffset,
      valueCoreStartOffset: segment.startOffset + valueCoreBounds.startOffset,
      valueCoreEndOffset: segment.startOffset + valueCoreBounds.endOffset,
      raw: segment.raw,
    });
  }
  return declarations;
}

function preferredQuote(element) {
  for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
    const quote = element.attributes[index].quote;
    if (quote === "\"" || quote === "'") return quote;
  }
  return "\"";
}

function encodeAttributeValueFragment(value, quote) {
  let result = String(value).replace(/&/g, "&amp;");
  if (quote === "\"") return result.replace(/"/g, "&quot;");
  if (quote === "'") return result.replace(/'/g, "&#39;");
  return result
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\f/g, "&#12;")
    .replace(/\r/g, "&#13;")
    .replace(/ /g, "&#32;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;")
    .replace(/=/g, "&#61;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function declarationFor(property, value, important, quote, compact = false) {
  const separator = compact ? ":" : ": ";
  const importantSource = important ? (compact ? "!important" : " !important") : "";
  return `${property}${separator}${encodeAttributeValueFragment(value, quote)}${importantSource}`;
}

function assertCommentFreeStyleSyntax(value, details = {}) {
  if (/\/\*|\*\//.test(String(value ?? ""))) {
    fail(
      "UNSAFE_STYLE_SYNTAX",
      "Inline style comments cannot be edited safely without changing CSS meaning.",
      details,
    );
  }
}

function assertCanonicalStyleProperties(rawStyle, details = {}) {
  for (const segment of declarationSegments(rawStyle)) {
    if (segment.raw.trim() === "") continue;
    const colon = topLevelColon(segment.raw);
    if (colon < 0) {
      fail(
        "UNSAFE_STYLE_SYNTAX",
        "Inline style contains declaration syntax that cannot be preserved safely.",
        details,
      );
    }
    const bounds = trimBounds(segment.raw, 0, colon);
    const property = segment.raw.slice(bounds.startOffset, bounds.endOffset);
    if (!CSS_PROPERTY_NAME_PATTERN.test(property)) {
      fail(
        "UNSAFE_STYLE_SYNTAX",
        "Inline style contains a non-canonical or escaped property name.",
        { ...details, property },
      );
    }
  }
}

function assertSingleCssValue(value, details = {}) {
  const source = String(value);
  if (source.trim() === "") {
    fail("INVALID_STYLE_VALUE", "Inline style value cannot be empty.", details);
  }
  const closingDelimiters = [];
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        if (index + 1 >= source.length) {
          fail("INVALID_STYLE_VALUE", "Inline style value has an incomplete escape.", details);
        }
        if (source[index + 1] === "\r" && source[index + 2] === "\n") index += 2;
        else index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === "\n" || char === "\r" || char === "\f") {
        fail("INVALID_STYLE_VALUE", "Inline style string is not closed safely.", details);
      }
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= source.length) {
        fail("INVALID_STYLE_VALUE", "Inline style value has an incomplete escape.", details);
      }
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      closingDelimiters.push(")");
      continue;
    }
    if (char === "[") {
      closingDelimiters.push("]");
      continue;
    }
    if (char === "{") {
      closingDelimiters.push("}");
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (closingDelimiters.pop() !== char) {
        fail("INVALID_STYLE_VALUE", "Inline style value has unmatched delimiters.", details);
      }
      continue;
    }
    if (
      closingDelimiters.length === 0
      && (char === ";" || char === "!")
    ) {
      fail(
        "UNSAFE_STYLE_VALUE",
        char === ";"
          ? "Inline style value cannot contain a top-level declaration separator."
          : "Use the explicit important option to change CSS priority.",
        details,
      );
    }
  }
  if (quote || closingDelimiters.length > 0) {
    fail("INVALID_STYLE_VALUE", "Inline style value is not syntactically balanced.", details);
  }
}

function patchExistingStyle(index, element, styleAttribute, command, property) {
  if (!styleAttribute.valueRange) {
    if (command.value === null || command.value === undefined) return [];
    const quote = preferredQuote(element);
    const declaration = declarationFor(property, command.value, Boolean(command.important), quote);
    return [sourcePatch(
      styleAttribute.range.startOffset,
      styleAttribute.range.endOffset,
      styleAttribute.raw,
      `${styleAttribute.rawName}=${quote}${declaration}${quote}`,
      { kind: "style-attribute", property, nodeId: element.nodeId },
    )];
  }

  const rawStyle = index.source.slice(
    styleAttribute.valueRange.startOffset,
    styleAttribute.valueRange.endOffset,
  );
  assertCommentFreeStyleSyntax(rawStyle, {
    nodeId: element.nodeId,
    property,
  });
  assertCanonicalStyleProperties(rawStyle, {
    nodeId: element.nodeId,
    property,
  });
  const declarations = parseInlineStyle(rawStyle);
  const matching = declarations.filter(
    (declaration) => declaration.normalizedProperty === property,
  );
  if (matching.length > 1) {
    fail(
      "DUPLICATE_STYLE_PROPERTY",
      `Inline style contains duplicate declarations for ${property}.`,
      { nodeId: element.nodeId, property },
    );
  }
  const declaration = matching[0] ?? null;
  if (
    declaration
    && Object.hasOwn(command, "beforeValue")
    && command.beforeValue !== declaration.value
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "The inline style value changed after the edit began.",
      { expected: command.beforeValue, actual: declaration.value },
    );
  }

  if (command.value === null || command.value === undefined) {
    if (!declaration) return [];
    const localStart = declaration.segmentStartOffset;
    const localEnd = declaration.separatorEndOffset;
    const nextRawStyle = rawStyle.slice(0, localStart) + rawStyle.slice(localEnd);
    if (nextRawStyle.replace(/[;\s]/g, "") === "") {
      return [sourcePatch(
        styleAttribute.removalRange.startOffset,
        styleAttribute.removalRange.endOffset,
        index.source.slice(
          styleAttribute.removalRange.startOffset,
          styleAttribute.removalRange.endOffset,
        ),
        "",
        { kind: "style-attribute-remove", property, nodeId: element.nodeId },
      )];
    }
    return [sourcePatch(
      styleAttribute.valueRange.startOffset + localStart,
      styleAttribute.valueRange.startOffset + localEnd,
      rawStyle.slice(localStart, localEnd),
      "",
      { kind: "style-declaration-remove", property, nodeId: element.nodeId },
    )];
  }

  const quote = styleAttribute.quote;
  if (declaration) {
    const preserveImportant = command.important === undefined;
    const important = preserveImportant ? declaration.important : Boolean(command.important);
    const importantRaw = important
      ? (
          preserveImportant && declaration.importantRaw
            ? declaration.importantRaw
            : (quote ? " !important" : "!important")
        )
      : "";
    const nextValue = `${encodeAttributeValueFragment(command.value, quote)}${importantRaw}`;
    return [sourcePatch(
      styleAttribute.valueRange.startOffset + declaration.valueStartOffset,
      styleAttribute.valueRange.startOffset + declaration.valueEndOffset,
      rawStyle.slice(declaration.valueStartOffset, declaration.valueEndOffset),
      nextValue,
      { kind: "style-declaration-update", property, nodeId: element.nodeId },
    )];
  }

  let insertionOffset = rawStyle.length;
  while (insertionOffset > 0 && /\s/.test(rawStyle[insertionOffset - 1])) insertionOffset -= 1;
  const compact = quote === null;
  const declarationSource = declarationFor(
    property,
    command.value,
    Boolean(command.important),
    quote,
    compact,
  );
  const meaningful = rawStyle.slice(0, insertionOffset).trim();
  const prefix = meaningful === ""
    ? ""
    : meaningful.endsWith(";")
      ? (compact ? "" : " ")
      : (compact ? ";" : "; ");
  return [sourcePatch(
    styleAttribute.valueRange.startOffset + insertionOffset,
    styleAttribute.valueRange.startOffset + insertionOffset,
    "",
    `${prefix}${declarationSource}`,
    { kind: "style-declaration-add", property, nodeId: element.nodeId },
  )];
}

export function planInlineStylePatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const element = resolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    element,
  );
  const property = normalizePropertyName(command.property);
  if (command.value !== null && command.value !== undefined) {
    assertCommentFreeStyleSyntax(command.value, {
      nodeId: element.nodeId,
      property,
    });
    assertSingleCssValue(command.value, {
      nodeId: element.nodeId,
      property,
    });
  }
  const styleAttributes = element.attributesByName.get("style") ?? [];
  if (styleAttributes.length > 1) {
    fail(
      "DUPLICATE_STYLE_ATTRIBUTE",
      "The selected element has duplicate style attributes, so the edit is unsafe.",
      { nodeId: element.nodeId },
    );
  }

  let patches;
  if (styleAttributes.length === 1) {
    patches = patchExistingStyle(index, element, styleAttributes[0], command, property);
  } else if (command.value === null || command.value === undefined) {
    patches = [];
  } else {
    const quote = preferredQuote(element);
    const declaration = declarationFor(
      property,
      command.value,
      Boolean(command.important),
      quote,
    );
    const offset = element.closingDelimiterOffset;
    patches = [sourcePatch(
      offset,
      offset,
      "",
      ` style=${quote}${declaration}${quote}`,
      { kind: "style-attribute-add", property, nodeId: element.nodeId },
    )];
  }

  return makePlan(
    index,
    { ...command, type: "set-inline-style" },
    patches,
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: element.nodeId,
      property,
      value: command.value ?? null,
      important: command.important,
      writeScope: "current-element-inline-style",
    },
  );
}

export function planTextRangeStylePatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const target = resolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    target,
  );
  const property = normalizePropertyName(command.property);
  if (command.value === null || command.value === undefined) {
    fail(
      "TEXT_RANGE_STYLE_VALUE_REQUIRED",
      "Partial text styling requires a concrete CSS value.",
      { property },
    );
  }
  assertCommentFreeStyleSyntax(command.value, {
    nodeId: target.nodeId,
    property,
  });
  assertSingleCssValue(command.value, {
    nodeId: target.nodeId,
    property,
  });
  const segments = normalizedTextRangeSegments(index, target, command.segments);
  const onlySegment = segments.length === 1 ? segments[0] : null;
  if (
    onlySegment
    && target.childIds.length === 1
    && target.childIds[0] === onlySegment.textNodeId
    && onlySegment.startOffset === 0
    && onlySegment.endOffset === onlySegment.textNode.value.length
  ) {
    // Styling the complete text of an existing element does not need another
    // wrapper. Reusing that element keeps repeated toolbar actions canonical
    // instead of producing span-inside-span growth.
    return planInlineStylePatch(index, {
      ...command,
      type: "set-inline-style",
      targetRef: currentTargetRef,
    });
  }
  const segmentParent = onlySegment?.textNode.parentId
    ? index.byNodeId.get(onlySegment.textNode.parentId)
    : null;
  if (
    onlySegment
    && segmentParent?.type === "element"
    && segmentParent.nodeId !== target.nodeId
    && segmentParent.childIds.length === 1
    && segmentParent.childIds[0] === onlySegment.textNodeId
    && onlySegment.startOffset === 0
    && onlySegment.endOffset === onlySegment.textNode.value.length
  ) {
    // The live selection remains authorized by its original ancestor, while
    // repeated formatting should update the text's existing immediate wrapper.
    // Keeping both refs lets the preview refresh the logical selection and the
    // actual style-write element without conflating their identities.
    const styleTargetRef = createTargetRef(index, segmentParent);
    const inlinePlan = planInlineStylePatch(index, {
      ...command,
      type: "set-inline-style",
      targetRef: styleTargetRef,
    });
    return makePlan(
      index,
      { ...command, type: "set-text-range-style" },
      inlinePlan.patches,
      [currentTargetRef, styleTargetRef],
      {
        resolution: resolution.resolution,
        nodeId: target.nodeId,
        property,
        value: command.value,
        important: command.important,
        segments: segments.map((segment) => ({
          textNodeId: segment.textNodeId,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
        })),
        writeScope: "existing-text-range-wrapper-inline-style",
        coalescedTextRangeElementId: segmentParent.nodeId,
      },
    );
  }
  const declaration = declarationFor(
    property,
    command.value,
    Boolean(command.important),
    "\"",
  );
  // Flex/grid direct-text and visible-background cases are rejected by the
  // canvas before this plan is applied. In supported inline flow, this wrapper
  // preserves Chromium's real caret/beforeinput/input behavior.
  const openingTag = `<span style="${TEXT_RANGE_LAYOUT_GUARD}; ${declaration}">`;
  const patches = segments.flatMap((segment) => ([
    sourcePatch(
      segment.rawStartOffset,
      segment.rawStartOffset,
      "",
      openingTag,
      {
        kind: "text-range-style-open",
        property,
        nodeId: segment.textNodeId,
      },
    ),
    sourcePatch(
      segment.rawEndOffset,
      segment.rawEndOffset,
      "",
      "</span>",
      {
        kind: "text-range-style-close",
        property,
        nodeId: segment.textNodeId,
      },
    ),
  ]));
  return makePlan(
    index,
    { ...command, type: "set-text-range-style" },
    patches,
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: target.nodeId,
      property,
      value: command.value,
      important: command.important,
      segments: segments.map((segment) => ({
        textNodeId: segment.textNodeId,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
      })),
      writeScope: "selected-text-ranges",
    },
  );
}

function gapBoundary(source, previousElement, nextElement) {
  const startOffset = previousElement.range.endOffset;
  const endOffset = nextElement.range.startOffset;
  const gap = source.slice(startOffset, endOffset);
  if (!gap.includes("<!--")) return startOffset;
  const firstComment = gap.indexOf("<!--");
  const beforeComment = gap.slice(0, firstComment);
  if (beforeComment === "") return endOffset;
  if (/\r|\n/.test(beforeComment)) return startOffset;
  fail(
    "UNSAFE_REORDER_BOUNDARY",
    "A comment between sibling modules has ambiguous ownership.",
    { startOffset, endOffset },
  );
}

function trailingCommentBoundary(source, parent, lastElement) {
  const startOffset = lastElement.range.endOffset;
  const endOffset = parent.contentRange.endOffset;
  const gap = source.slice(startOffset, endOffset);
  if (!gap.includes("<!--")) return startOffset;
  if (!gap.startsWith("<!--")) {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "A trailing comment is separated from the last module, so ownership is ambiguous.",
      { startOffset, endOffset },
    );
  }

  let cursor = 0;
  let commentCount = 0;
  while (gap.startsWith("<!--", cursor)) {
    const commentEnd = gap.indexOf("-->", cursor + 4);
    if (commentEnd < 0) {
      fail(
        "UNSAFE_REORDER_BOUNDARY",
        "A trailing comment does not have a complete source boundary.",
        { startOffset, endOffset },
      );
    }
    cursor = commentEnd + 3;
    commentCount += 1;
  }
  const remaining = gap.slice(cursor);
  if (remaining.includes("<!--") || remaining.trim() !== "") {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "Trailing comment ownership is ambiguous.",
      { startOffset, endOffset },
    );
  }
  return commentCount > 0 ? startOffset + cursor : startOffset;
}

function reorderUnits(index, parent) {
  if (!parent.boundarySafe || !parent.explicitEndTag) {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "The parent source boundary is not explicit enough for safe reordering.",
      { parentId: parent.nodeId },
    );
  }
  const childNodes = parent.childIds.map((nodeId) => index.byNodeId.get(nodeId));
  const unsafeText = childNodes.find(
    (node) => node.type === "text" && !node.whitespaceOnly,
  );
  if (unsafeText) {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "Sibling reordering cannot move across non-whitespace text nodes.",
      { nodeId: unsafeText.nodeId },
    );
  }
  const elements = parent.childElementIds.map((nodeId) => index.byNodeId.get(nodeId));
  if (elements.length < 2) {
    fail("REORDER_REQUIRES_SIBLINGS", "The selected module has no reorderable sibling.");
  }
  for (const element of elements) {
    const selfClosing = element.startTagRange.endOffset === element.range.endOffset
      && /\/\s*>$/.test(element.startTagRaw);
    if (!element.explicitEndTag && !element.isVoid && !selfClosing) {
      fail(
        "UNSAFE_REORDER_BOUNDARY",
        "A sibling has an implicit closing boundary.",
        { nodeId: element.nodeId },
      );
    }
  }

  const boundaries = [];
  for (let indexPosition = 0; indexPosition < elements.length - 1; indexPosition += 1) {
    boundaries.push(gapBoundary(index.source, elements[indexPosition], elements[indexPosition + 1]));
  }
  const trailingBoundary = trailingCommentBoundary(
    index.source,
    parent,
    elements.at(-1),
  );
  return elements.map((element, position) => {
    const startOffset = position === 0
      ? parent.contentRange.startOffset
      : boundaries[position - 1];
    const endOffset = position === elements.length - 1
      ? trailingBoundary
      : boundaries[position];
    return {
      nodeId: element.nodeId,
      element,
      startOffset,
      endOffset,
      raw: index.source.slice(startOffset, endOffset),
    };
  });
}

export function planSiblingReorderPatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const targetResolution = resolvedTarget(index, targetRef, "element");
  const moving = targetResolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    moving,
  );
  const parent = moving.parentId ? index.byNodeId.get(moving.parentId) : null;
  if (!parent || parent.type !== "element") {
    fail("REORDER_PARENT_REQUIRED", "The selected module has no source-backed parent.");
  }
  const units = reorderUnits(index, parent);
  const oldOrder = units.map((unit) => unit.nodeId);
  const movingIndex = oldOrder.indexOf(moving.nodeId);
  const remaining = oldOrder.filter((nodeId) => nodeId !== moving.nodeId);

  let insertionIndex;
  let beforeTargetRef = null;
  let currentBeforeTargetRef = null;
  if (command.beforeTargetRef || command.beforeNodeId) {
    beforeTargetRef = commandTargetRef(index, command, "beforeTargetRef");
    const beforeResolution = resolvedTarget(index, beforeTargetRef, "element");
    currentBeforeTargetRef = refreshResolvedTargetRef(
      index,
      beforeTargetRef,
      beforeResolution.target,
    );
    if (beforeResolution.target.parentId !== parent.nodeId) {
      fail(
        "REORDER_DIFFERENT_PARENT",
        "Sibling reorder targets must have the same parent.",
      );
    }
    if (beforeResolution.target.nodeId === moving.nodeId) {
      insertionIndex = movingIndex;
    } else {
      insertionIndex = remaining.indexOf(beforeResolution.target.nodeId);
    }
  } else if (Number.isInteger(command.toIndex)) {
    if (command.toIndex < 0 || command.toIndex > remaining.length) {
      fail("INVALID_REORDER_INDEX", "Requested sibling index is outside the parent.");
    }
    insertionIndex = command.toIndex;
  } else {
    insertionIndex = remaining.length;
  }

  const nextOrder = [...remaining];
  nextOrder.splice(insertionIndex, 0, moving.nodeId);
  if (
    Array.isArray(command.beforeOrder)
    && command.beforeOrder.join("\u0000") !== oldOrder.join("\u0000")
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "Sibling order changed after the reorder gesture began.",
      { expected: command.beforeOrder, actual: oldOrder },
    );
  }

  let firstChanged = -1;
  let lastChanged = -1;
  for (let position = 0; position < oldOrder.length; position += 1) {
    if (oldOrder[position] !== nextOrder[position]) {
      if (firstChanged < 0) firstChanged = position;
      lastChanged = position;
    }
  }
  const patches = [];
  if (firstChanged >= 0) {
    const byNodeId = new Map(units.map((unit) => [unit.nodeId, unit]));
    const startOffset = units[firstChanged].startOffset;
    const endOffset = units[lastChanged].endOffset;
    const before = index.source.slice(startOffset, endOffset);
    const after = nextOrder
      .slice(firstChanged, lastChanged + 1)
      .map((nodeId) => byNodeId.get(nodeId).raw)
      .join("");
    patches.push(sourcePatch(
      startOffset,
      endOffset,
      before,
      after,
      {
        kind: "sibling-reorder",
        parentId: parent.nodeId,
        movedNodeId: moving.nodeId,
      },
    ));
  }

  return makePlan(
    index,
    { ...command, type: "reorder-sibling" },
    patches,
    currentBeforeTargetRef
      ? [currentTargetRef, currentBeforeTargetRef]
      : [currentTargetRef],
    {
      resolution: targetResolution.resolution,
      parentNodeId: parent.nodeId,
      beforeOrder: oldOrder,
      nextOrder,
    },
  );
}

export function planSourcePatch(command, indexOrHtml) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  switch (command?.type) {
    case "text":
    case "replace-text":
      return planTextPatch(index, command);
    case "text-range":
    case "replace-text-range":
      return planTextRangePatch(index, command);
    case "text-flow-range":
    case "replace-text-flow-range":
      return planTextFlowRangePatch(index, command);
    case "delete-hard-break":
      return planDeleteHardBreakPatch(index, command);
    case "split-text-block":
      return planSplitTextBlockPatch(index, command);
    case "style":
    case "set-inline-style":
      return planInlineStylePatch(index, command);
    case "text-range-style":
    case "set-text-range-style":
      return planTextRangeStylePatch(index, command);
    case "reorder":
    case "reorder-sibling":
      return planSiblingReorderPatch(index, command);
    default:
      fail("UNSUPPORTED_EDIT_COMMAND", `Unsupported edit command: ${command?.type ?? "missing"}.`);
  }
}

function normalizePatches(patches) {
  const ordered = [...(patches ?? [])].sort((left, right) => left.startOffset - right.startOffset);
  let previousEnd = -1;
  for (const patch of ordered) {
    if (
      !Number.isInteger(patch.startOffset)
      || !Number.isInteger(patch.endOffset)
      || patch.startOffset < 0
      || patch.endOffset < patch.startOffset
      || typeof patch.before !== "string"
      || typeof patch.after !== "string"
    ) {
      fail("INVALID_PATCH_RANGE", "Patch range or source content is invalid.", { patch });
    }
    if (patch.startOffset < previousEnd) {
      fail("OVERLAPPING_PATCHES", "Patch ranges overlap.", { patches: ordered });
    }
    previousEnd = patch.endOffset;
  }
  return ordered;
}

function renderPatches(source, patches) {
  let result = source;
  for (const patch of [...patches].sort((left, right) => right.startOffset - left.startOffset)) {
    result = result.slice(0, patch.startOffset) + patch.after + result.slice(patch.endOffset);
  }
  return result;
}

export function validatePatchScope(baseHtml, nextHtml, patches) {
  const ordered = normalizePatches(patches);
  const expected = renderPatches(baseHtml, ordered);
  if (expected !== nextHtml) {
    return {
      verdict: "rejected",
      outsideUnchanged: false,
      reason: "output-does-not-equal-declared-patches",
      allowedRanges: ordered.map((patch) => ({
        startOffset: patch.startOffset,
        endOffset: patch.endOffset,
      })),
    };
  }
  let baseCursor = 0;
  let nextCursor = 0;
  const protectedSegments = [];
  for (const patch of ordered) {
    const length = patch.startOffset - baseCursor;
    const baseSegment = baseHtml.slice(baseCursor, patch.startOffset);
    const nextSegment = nextHtml.slice(nextCursor, nextCursor + length);
    if (baseSegment !== nextSegment) {
      return {
        verdict: "rejected",
        outsideUnchanged: false,
        reason: "protected-segment-changed",
      };
    }
    protectedSegments.push({
      baseStartOffset: baseCursor,
      baseEndOffset: patch.startOffset,
      nextStartOffset: nextCursor,
      nextEndOffset: nextCursor + length,
    });
    baseCursor = patch.endOffset;
    nextCursor += length + patch.after.length;
  }
  const baseSuffix = baseHtml.slice(baseCursor);
  const nextSuffix = nextHtml.slice(nextCursor);
  if (baseSuffix !== nextSuffix) {
    return {
      verdict: "rejected",
      outsideUnchanged: false,
      reason: "protected-suffix-changed",
    };
  }
  protectedSegments.push({
    baseStartOffset: baseCursor,
    baseEndOffset: baseHtml.length,
    nextStartOffset: nextCursor,
    nextEndOffset: nextHtml.length,
  });
  return {
    verdict: "allowed",
    outsideUnchanged: true,
    reason: "only-declared-source-ranges-changed",
    allowedRanges: ordered.map((patch) => ({
      startOffset: patch.startOffset,
      endOffset: patch.endOffset,
      kind: patch.kind,
    })),
    protectedSegments,
  };
}

function inversePatches(patches) {
  let delta = 0;
  const inverse = patches.map((patch) => {
    const startOffset = patch.startOffset + delta;
    const inversePatch = sourcePatch(
      startOffset,
      startOffset + patch.after.length,
      patch.after,
      patch.before,
      { kind: `inverse:${patch.kind ?? "source"}` },
    );
    delta += patch.after.length - patch.before.length;
    return inversePatch;
  });
  const coalesced = [];
  for (const patch of inverse) {
    const previous = coalesced.at(-1);
    if (previous && previous.startOffset === patch.startOffset) {
      // Adjacent forward deletions collapse to one output boundary. Their
      // inverse insertions must be one ordered patch; independent zero-width
      // patches at the same offset render in reverse order and cannot restore
      // the recorded source hash.
      previous.endOffset = Math.max(previous.endOffset, patch.endOffset);
      previous.before += patch.before;
      previous.after += patch.after;
      if (previous.kind !== patch.kind) previous.kind = "inverse:source";
      continue;
    }
    coalesced.push({ ...patch });
  }
  return coalesced;
}

function operationTypeForPlan(plan) {
  const value = String(plan?.metadata?.operationType ?? plan?.type ?? "");
  return value.replace(/^(?:inverse:)+/, "");
}

function patchesEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((patch, index) => {
    const candidate = right[index];
    return patch.startOffset === candidate.startOffset
      && patch.endOffset === candidate.endOffset
      && patch.before === candidate.before
      && patch.after === candidate.after
      && patch.kind === candidate.kind;
  });
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function inverseProvenanceToken(provenance, targetRefs) {
  return sourceSha256(canonicalValue({
    baseSourceSha256: provenance.baseSourceSha256,
    outputSourceSha256: provenance.outputSourceSha256,
    operationType: provenance.operationType,
    appliedPatches: provenance.appliedPatches,
    targetRefs,
  }));
}

function registerTrustedInversePlan(plan) {
  TRUSTED_INVERSE_PLANS.set(plan, canonicalValue(plan));
}

function validateTrustedInversePlan(plan) {
  const trustedSnapshot = TRUSTED_INVERSE_PLANS.get(plan);
  if (!trustedSnapshot) {
    fail(
      "INVERSE_PLAN_UNTRUSTED",
      "Inverse patches can only be applied from a PatchEngine-generated history entry.",
    );
  }
  if (trustedSnapshot !== canonicalValue(plan)) {
    fail(
      "INVERSE_PLAN_TAMPERED",
      "The generated inverse patch plan changed after it was created.",
    );
  }
}

function validateInverseProvenance(plan, index, patches, targetRefs) {
  const provenance = plan.metadata?.inverseProvenance;
  if (!provenance || typeof provenance !== "object") {
    fail(
      "INVERSE_PROVENANCE_REQUIRED",
      "Inverse patch plan is missing its generated source provenance.",
    );
  }
  const expectedToken = inverseProvenanceToken(provenance, targetRefs);
  if (
    provenance.outputSourceSha256 !== index.sourceSha256
    || provenance.token !== expectedToken
  ) {
    fail(
      "INVERSE_PROVENANCE_INVALID",
      "Inverse patch provenance does not match its source or TargetRefs.",
    );
  }
  const expectedPatches = inversePatches(provenance.appliedPatches ?? []);
  if (!patchesEqual(patches, expectedPatches)) {
    fail(
      "INVERSE_PLAN_TAMPERED",
      "Inverse patches are not the exact inverse of the generated source patches.",
    );
  }
  const restoredSource = renderPatches(index.source, patches);
  if (sourceSha256(restoredSource) !== provenance.baseSourceSha256) {
    fail(
      "INVERSE_PLAN_TAMPERED",
      "Inverse patches do not restore the recorded source hash.",
    );
  }
}

function assertPatchWithin(patch, allowedRange, code, message) {
  if (
    patch.startOffset < allowedRange.startOffset
    || patch.endOffset > allowedRange.endOffset
  ) {
    fail(code, message, { patch, allowedRange });
  }
}

function authorizePatchPlan(plan, index, patches) {
  const isInverse = String(plan?.type ?? "").startsWith("inverse:");
  if (isInverse) validateTrustedInversePlan(plan);
  if (!Array.isArray(plan.targetRefs) || plan.targetRefs.length === 0) {
    fail(
      "PATCH_TARGETS_REQUIRED",
      "Every source patch plan must declare at least one operation TargetRef.",
    );
  }
  const operationType = operationTypeForPlan(plan);
  if (![
    "replace-text",
    "replace-text-range",
    "replace-text-flow-range",
    "delete-hard-break",
    "split-text-block",
    "set-inline-style",
    "set-text-range-style",
    "reorder-sibling",
  ].includes(operationType)) {
    fail(
      "UNSUPPORTED_PATCH_PLAN_TYPE",
      `Unsupported patch plan type: ${operationType || "missing"}.`,
    );
  }
  const targetRefs = plan.targetRefs.map((targetRef) => cleanTargetRef(targetRef));
  const resolutions = targetRefs.map((targetRef) => {
    if (targetRef.resolution !== "exact") {
      fail(
        "PATCH_TARGET_NOT_EXACT",
        "Patch operation TargetRefs must declare exact resolution.",
        { targetRef },
      );
    }
    if (targetRef.sourceAnchor?.sourceSha256 !== index.sourceSha256) {
      fail(
        "PATCH_TARGET_NOT_EXACT",
        "Patch operation TargetRefs must be refreshed against the exact source hash.",
        { targetRef, sourceSha256: index.sourceSha256 },
      );
    }
    const resolution = resolveTargetRef(index, targetRef);
    if (resolution.resolution !== "exact" || !resolution.target) {
      fail(
        resolution.resolution === "ambiguous"
          ? "TARGET_AMBIGUOUS"
          : "TARGET_ORPHANED",
        "Patch operation TargetRef is not exact in the declared source.",
        { targetRef, resolution },
      );
    }
    return resolution;
  });
  if (isInverse) {
    validateInverseProvenance(plan, index, patches, targetRefs);
  }

  if (operationType === "replace-text") {
    if (targetRefs.length !== 1) {
      fail("PATCH_TARGET_COUNT_INVALID", "Text patch requires exactly one TargetRef.");
    }
    const { textNode } = pureTextTarget(index, targetRefs[0]);
    for (const patch of patches) {
      if (String(patch.kind ?? "").replace(/^(?:inverse:)+/, "") !== "text") {
        fail("PATCH_KIND_MISMATCH", "Text patch has a non-text source operation.", { patch });
      }
      if (
        patch.startOffset !== textNode.range.startOffset
        || patch.endOffset !== textNode.range.endOffset
      ) {
        fail(
          "PATCH_OUTSIDE_TARGET",
          "Text patch does not exactly match the authorized text-node range.",
          { patch, targetRange: textNode.range },
        );
      }
    }
    if (!isInverse) {
      const expected = planTextPatch(index, {
        type: "replace-text",
        targetRef: targetRefs[0],
        beforeText: plan.metadata?.beforeText,
        nextText: plan.metadata?.nextText,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Text patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "replace-text-range") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Text range patch requires one element TargetRef.");
    }
    const element = resolutions[0].target;
    for (const patch of patches) {
      if (String(patch.kind ?? "").replace(/^(?:inverse:)+/, "") !== "text-range") {
        fail("PATCH_KIND_MISMATCH", "Text range patch has an unrelated source operation.", { patch });
      }
      assertPatchWithin(
        patch,
        element.contentRange,
        "PATCH_OUTSIDE_TARGET",
        "Text range patch is outside the authorized element content.",
      );
    }
    if (!isInverse) {
      const replacementMetadata = plan.metadata?.replacements;
      const expected = planTextRangePatch(index, {
        type: "replace-text-range",
        targetRef: targetRefs[0],
        beforeText: plan.metadata?.beforeText,
        ...(Array.isArray(replacementMetadata)
          ? { replacements: replacementMetadata }
          : {
            segments: plan.metadata?.segments,
            nextText: plan.metadata?.nextText,
          }),
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Text range patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "replace-text-flow-range") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Text flow patch requires one element TargetRef.");
    }
    const element = resolutions[0].target;
    for (const patch of patches) {
      if (String(patch.kind ?? "").replace(/^(?:inverse:)+/, "") !== "text-flow") {
        fail("PATCH_KIND_MISMATCH", "Text flow patch has an unrelated source operation.", { patch });
      }
      assertPatchWithin(
        patch,
        element.contentRange,
        "PATCH_OUTSIDE_TARGET",
        "Text flow patch is outside the authorized element content.",
      );
    }
    if (!isInverse) {
      const expected = planTextFlowRangePatch(index, {
        type: "replace-text-flow-range",
        targetRef: targetRefs[0],
        beforeText: plan.metadata?.beforeText,
        replacements: plan.metadata?.replacements,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Text flow patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "delete-hard-break") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Hard-break deletion requires one element TargetRef.");
    }
    const element = resolutions[0].target;
    for (const patch of patches) {
      if (String(patch.kind ?? "").replace(/^(?:inverse:)+/, "") !== "hard-break") {
        fail("PATCH_KIND_MISMATCH", "Hard-break deletion has an unrelated source operation.", { patch });
      }
      assertPatchWithin(
        patch,
        element.contentRange,
        "PATCH_OUTSIDE_TARGET",
        "Hard-break deletion is outside the authorized element content.",
      );
    }
    if (!isInverse) {
      const expected = planDeleteHardBreakPatch(index, {
        type: "delete-hard-break",
        targetRef: targetRefs[0],
        hardBreakNodeId: plan.metadata?.hardBreakNodeId,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Hard-break deletion does not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "split-text-block") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Block split requires one element TargetRef.");
    }
    const element = resolutions[0].target;
    const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
    if (isInverse && parent?.type !== "element") {
      fail("BLOCK_SPLIT_PARENT_REQUIRED", "Block split inverse requires its source parent.");
    }
    for (const patch of patches) {
      if (String(patch.kind ?? "").replace(/^(?:inverse:)+/, "") !== "block-split") {
        fail("PATCH_KIND_MISMATCH", "Block split has an unrelated source operation.", { patch });
      }
      assertPatchWithin(
        patch,
        isInverse ? parent.contentRange : element.contentRange,
        "PATCH_OUTSIDE_TARGET",
        "Block split is outside the authorized source boundary.",
      );
    }
    if (!isInverse) {
      const expected = planSplitTextBlockPatch(index, {
        type: "split-text-block",
        targetRef: targetRefs[0],
        splitOffset: plan.metadata?.splitOffset,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Block split does not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "set-inline-style") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Inline style patch requires one element TargetRef.");
    }
    const element = resolutions[0].target;
    for (const patch of patches) {
      if (!String(patch.kind ?? "").includes("style")) {
        fail("PATCH_KIND_MISMATCH", "Inline style patch has a non-style operation.", { patch });
      }
      assertPatchWithin(
        patch,
        element.startTagRange,
        "PATCH_OUTSIDE_TARGET",
        "Inline style patch is outside the authorized start tag.",
      );
    }
    if (!isInverse) {
      const expected = planInlineStylePatch(index, {
        type: "set-inline-style",
        targetRef: targetRefs[0],
        property: plan.metadata?.property,
        value: plan.metadata?.value,
        important: plan.metadata?.important,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Inline style patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "set-text-range-style") {
    const coalescesExistingWrapper = String(plan.metadata?.writeScope ?? "")
      .startsWith("existing-text-range-wrapper-inline-style");
    const expectedTargetCount = coalescesExistingWrapper ? 2 : 1;
    if (
      targetRefs.length !== expectedTargetCount
      || resolutions.some((resolution) => resolution.target.type !== "element")
    ) {
      fail(
        "PATCH_TARGET_COUNT_INVALID",
        `Text range style patch requires ${expectedTargetCount} element TargetRef${expectedTargetCount === 1 ? "" : "s"}.`,
      );
    }
    const element = resolutions[0].target;
    const styleElement = coalescesExistingWrapper ? resolutions[1].target : null;
    if (
      styleElement
      && (
        !isDescendantNode(index, styleElement, element)
        || styleElement.parentId === null
      )
    ) {
      fail(
        "TEXT_RANGE_TARGET_MISMATCH",
        "The existing text wrapper no longer belongs to the authorized source element.",
      );
    }
    for (const patch of patches) {
      const patchKind = String(patch.kind ?? "");
      const normalizedPatchKind = patchKind.replace(/^(?:inverse:)+/, "");
      const expectedPatchKind = coalescesExistingWrapper
        ? "style"
        : "text-range-style";
      if (!normalizedPatchKind.includes(expectedPatchKind)) {
        fail("PATCH_KIND_MISMATCH", "Text range style patch has an unrelated source operation.", { patch });
      }
      assertPatchWithin(
        patch,
        styleElement?.startTagRange ?? element.contentRange,
        "PATCH_OUTSIDE_TARGET",
        coalescesExistingWrapper
          ? "Text range style patch is outside the authorized wrapper start tag."
          : "Text range style patch is outside the authorized element content.",
      );
    }
    if (!isInverse) {
      const expected = planTextRangeStylePatch(index, {
        type: "set-text-range-style",
        targetRef: targetRefs[0],
        segments: plan.metadata?.segments,
        property: plan.metadata?.property,
        value: plan.metadata?.value,
        important: plan.metadata?.important,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Text range style patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "reorder-sibling") {
    if (targetRefs.length > 2 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Sibling reorder has invalid operation TargetRefs.");
    }
    const moving = resolutions[0].target;
    const parent = moving.parentId ? index.byNodeId.get(moving.parentId) : null;
    if (!parent || parent.type !== "element") {
      fail("REORDER_PARENT_REQUIRED", "Authorized reorder target has no source parent.");
    }
    if (
      resolutions[1]
      && (
        resolutions[1].target.type !== "element"
        || resolutions[1].target.parentId !== parent.nodeId
      )
    ) {
      fail("REORDER_DIFFERENT_PARENT", "Authorized reorder targets have different parents.");
    }
    for (const patch of patches) {
      if (!String(patch.kind ?? "").includes("reorder")) {
        fail("PATCH_KIND_MISMATCH", "Sibling reorder has a non-reorder operation.", { patch });
      }
      assertPatchWithin(
        patch,
        parent.contentRange,
        "PATCH_OUTSIDE_TARGET",
        "Sibling reorder patch is outside the authorized parent content.",
      );
      if (
        patch.endOffset <= moving.range.startOffset
        || patch.startOffset >= moving.range.endOffset
      ) {
        fail(
          "PATCH_OUTSIDE_TARGET",
          "Sibling reorder patch does not include the moved target fragment.",
          { patch, targetRange: moving.range },
        );
      }
    }
    if (!isInverse) {
      const desiredIndex = plan.metadata?.nextOrder?.indexOf(moving.nodeId);
      const expected = planSiblingReorderPatch(index, {
        type: "reorder-sibling",
        targetRef: targetRefs[0],
        ...(targetRefs[1]
          ? { beforeTargetRef: targetRefs[1] }
          : { toIndex: desiredIndex }),
        beforeOrder: plan.metadata?.beforeOrder,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Sibling reorder patches do not match the declared operation metadata.",
        );
      }
    }
  }

  return { operationType, targetRefs, resolutions };
}

function transformedOffset(offset, patches, affinity = "start") {
  let delta = 0;
  for (const patch of patches) {
    if (offset < patch.startOffset) break;
    if (offset > patch.endOffset) {
      delta += patch.after.length - patch.before.length;
      continue;
    }
    if (offset === patch.endOffset) {
      return patch.startOffset + delta + patch.after.length;
    }
    if (offset === patch.startOffset || offset < patch.endOffset) {
      return patch.startOffset + delta + (affinity === "end" ? patch.after.length : 0);
    }
  }
  return offset + delta;
}

function reorderIdentityMap(plan, baseIndex, nextIndex) {
  if (
    operationTypeForPlan(plan) !== "reorder-sibling"
    || !Array.isArray(plan.metadata?.nextOrder)
  ) {
    return null;
  }
  const oldParent = baseIndex.byNodeId.get(plan.metadata.parentNodeId);
  if (!oldParent || oldParent.type !== "element") return null;
  const nextParentStart = transformedOffset(
    oldParent.range.startOffset,
    normalizePatches(plan.patches),
  );
  const nextParent = nextIndex.elements.find((element) => (
    element.tagName === oldParent.tagName
    && element.range.startOffset === nextParentStart
  ));
  if (!nextParent) return null;
  const nextChildren = nextParent.childElementIds.map(
    (nodeId) => nextIndex.byNodeId.get(nodeId),
  );
  if (nextChildren.length !== plan.metadata.nextOrder.length) return null;
  const childMap = new Map();
  plan.metadata.nextOrder.forEach((oldNodeId, position) => {
    childMap.set(oldNodeId, nextChildren[position]);
  });
  return { oldParent, nextParent, childMap };
}

function directChildUnder(index, node, parentId) {
  let current = node;
  while (current?.parentId && current.parentId !== parentId) {
    current = index.byNodeId.get(current.parentId);
  }
  return current?.parentId === parentId ? current : null;
}

function deterministicMappedNode(plan, baseIndex, nextIndex, patches, baseNode) {
  const reorderMap = reorderIdentityMap(plan, baseIndex, nextIndex);
  if (reorderMap) {
    if (baseNode.nodeId === reorderMap.oldParent.nodeId) return reorderMap.nextParent;
    const oldTop = directChildUnder(
      baseIndex,
      baseNode,
      reorderMap.oldParent.nodeId,
    );
    const nextTop = oldTop ? reorderMap.childMap.get(oldTop.nodeId) : null;
    if (oldTop && nextTop) {
      if (baseNode.nodeId === oldTop.nodeId) return nextTop;
      const relativeStart = baseNode.range.startOffset - oldTop.range.startOffset;
      const relativeEnd = baseNode.range.endOffset - oldTop.range.startOffset;
      const candidates = nextIndex.nodes.filter((node) => (
        node.type === baseNode.type
        && node.range.startOffset - nextTop.range.startOffset === relativeStart
        && node.range.endOffset - nextTop.range.startOffset === relativeEnd
        && (
          node.type !== "element"
          || node.tagName === baseNode.tagName
        )
      ));
      if (candidates.length === 1) return candidates[0];
    }
  }

  if (baseNode.type === "text") {
    const replacing = patches.find((patch) => (
      patch.startOffset === baseNode.range.startOffset
      && patch.endOffset === baseNode.range.endOffset
    ));
    const startOffset = transformedOffset(baseNode.range.startOffset, patches);
    const endOffset = replacing
      ? startOffset + replacing.after.length
      : transformedOffset(baseNode.range.endOffset, patches, "end");
    return nextIndex.textNodes.find((node) => (
      node.range.startOffset === startOffset
      && node.range.endOffset === endOffset
    )) ?? null;
  }
  if (baseNode.type === "element") {
    const startOffset = transformedOffset(baseNode.range.startOffset, patches);
    return nextIndex.elements.find((element) => (
      element.tagName === baseNode.tagName
      && element.range.startOffset === startOffset
    )) ?? null;
  }
  return null;
}

function unresolvedTargetMapping(
  beforeTargetRef,
  beforeResolution,
  tracked,
  resolution = beforeResolution.resolution,
) {
  return {
    targetId: beforeTargetRef.targetId,
    beforeTargetRef,
    afterTargetRef: cleanTargetRef(beforeTargetRef, resolution),
    beforeNodeId: beforeResolution.target?.nodeId ?? null,
    afterNodeId: null,
    resolution,
    tracked,
  };
}

function mappedInsertionPointRef(
  plan,
  baseIndex,
  nextIndex,
  patches,
  beforeTargetRef,
  beforeResolution,
  tracked,
) {
  const insertion = beforeResolution.target;
  if (!insertion || insertion.type !== "insertion-point") {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
    );
  }
  const oldParent = baseIndex.byNodeId.get(insertion.parentId);
  if (!oldParent || oldParent.type !== "element") {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
      "orphaned",
    );
  }
  const nextParent = deterministicMappedNode(
    plan,
    baseIndex,
    nextIndex,
    patches,
    oldParent,
  );
  if (!nextParent || nextParent.type !== "element") {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
      "orphaned",
    );
  }

  let nextBeforeSibling = null;
  if (insertion.offset !== oldParent.contentRange.endOffset) {
    const oldBeforeSibling = oldParent.childElementIds
      .map((nodeId) => baseIndex.byNodeId.get(nodeId))
      .find((element) => element.range.startOffset === insertion.offset);
    if (!oldBeforeSibling) {
      return unresolvedTargetMapping(
        beforeTargetRef,
        beforeResolution,
        tracked,
        "orphaned",
      );
    }
    nextBeforeSibling = deterministicMappedNode(
      plan,
      baseIndex,
      nextIndex,
      patches,
      oldBeforeSibling,
    );
    if (
      !nextBeforeSibling
      || nextBeforeSibling.type !== "element"
      || nextBeforeSibling.parentId !== nextParent.nodeId
    ) {
      return unresolvedTargetMapping(
        beforeTargetRef,
        beforeResolution,
        tracked,
        "orphaned",
      );
    }
  }

  const afterTargetRef = createInsertionPointTargetRef(nextIndex, {
    parentId: nextParent.nodeId,
    ...(nextBeforeSibling ? { beforeSiblingId: nextBeforeSibling.nodeId } : {}),
    targetId: beforeTargetRef.targetId,
    label: beforeTargetRef.label,
  });
  return {
    targetId: beforeTargetRef.targetId,
    beforeTargetRef,
    afterTargetRef,
    beforeNodeId: null,
    afterNodeId: null,
    beforeParentId: oldParent.nodeId,
    afterParentId: nextParent.nodeId,
    resolution: "exact",
    tracked,
  };
}

function mappedTargetRef(plan, baseIndex, nextIndex, patches, targetRef, tracked) {
  const beforeTargetRef = cleanTargetRef(targetRef);
  let beforeResolution;
  try {
    beforeResolution = resolveTargetRef(baseIndex, beforeTargetRef);
  } catch (error) {
    if (!tracked) throw error;
    return unresolvedTargetMapping(
      beforeTargetRef,
      { resolution: "orphaned", target: null, error },
      tracked,
      "orphaned",
    );
  }
  if (beforeTargetRef.level === "insertion-point") {
    return mappedInsertionPointRef(
      plan,
      baseIndex,
      nextIndex,
      patches,
      beforeTargetRef,
      beforeResolution,
      tracked,
    );
  }
  if (
    !beforeResolution.target
    || !["element", "text"].includes(beforeResolution.target.type)
  ) {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
    );
  }
  const nextNode = deterministicMappedNode(
    plan,
    baseIndex,
    nextIndex,
    patches,
    beforeResolution.target,
  );
  if (nextNode) {
    const afterTargetRef = createTargetRef(nextIndex, nextNode, {
      targetId: beforeTargetRef.targetId,
      label: beforeTargetRef.label,
      level: beforeTargetRef.level,
    });
    return {
      targetId: beforeTargetRef.targetId,
      beforeTargetRef,
      afterTargetRef,
      beforeNodeId: beforeResolution.target.nodeId,
      afterNodeId: nextNode.nodeId,
      resolution: "exact",
      tracked,
    };
  }
  return unresolvedTargetMapping(
    beforeTargetRef,
    beforeResolution,
    tracked,
    "orphaned",
  );
}

function mirroredReorderMetadata(plan, mapping) {
  if (!mapping || operationTypeForPlan(plan) !== "reorder-sibling") return {};
  const oldToNew = new Map(
    [...mapping.childMap.entries()].map(([oldNodeId, node]) => [oldNodeId, node.nodeId]),
  );
  return {
    parentNodeId: mapping.nextParent.nodeId,
    beforeOrder: plan.metadata.nextOrder.map((nodeId) => oldToNew.get(nodeId)),
    nextOrder: plan.metadata.beforeOrder.map((nodeId) => oldToNew.get(nodeId)),
  };
}

export function applyPatchPlan(plan, sourceHtml, options = {}) {
  const source = String(sourceHtml);
  const actualSourceSha256 = sourceSha256(source);
  if (actualSourceSha256 !== plan.sourceSha256) {
    fail(
      "STALE_SOURCE_HASH",
      "The source changed before the patch could be applied.",
      { expectedSourceSha256: plan.sourceSha256, actualSourceSha256 },
    );
  }
  const patches = normalizePatches(plan.patches);
  for (const patch of patches) {
    if (patch.endOffset > source.length) {
      fail("INVALID_PATCH_RANGE", "Patch range is outside the source.", { patch });
    }
  }
  const baseIndex = buildSourceIndex(source);
  const authorization = authorizePatchPlan(plan, baseIndex, patches);
  for (const patch of patches) {
    const actual = source.slice(patch.startOffset, patch.endOffset);
    if (actual !== patch.before) {
      fail(
        "STALE_BEFORE_CONTENT",
        "The exact source range changed before the patch could be applied.",
        { patch, actual },
      );
    }
  }
  const html = renderPatches(source, patches);
  const scopeReport = validatePatchScope(source, html, patches);
  if (!scopeReport.outsideUnchanged) {
    fail("OUTSIDE_TARGET_CHANGED", "Source outside the declared patch ranges changed.", scopeReport);
  }

  const nextIndex = buildSourceIndex(html);
  const parseIntegrity = compareParseIntegrity(baseIndex, nextIndex);
  if (!parseIntegrity.ok) {
    fail(
      "PARSE_INTEGRITY_FAILED",
      "The patched HTML introduced parser or source-range errors.",
      parseIntegrity,
    );
  }

  const nextSourceSha256 = nextIndex.sourceSha256;
  const trackedTargetRefs = Array.isArray(options.trackedTargetRefs)
    ? options.trackedTargetRefs
    : Array.isArray(plan.trackedTargetRefs)
      ? plan.trackedTargetRefs
      : [];
  const operationMappings = authorization.targetRefs.map(
    (targetRef) => mappedTargetRef(
      plan,
      baseIndex,
      nextIndex,
      patches,
      targetRef,
      false,
    ),
  );
  const operationTargetIds = new Set(
    operationMappings.map((mapping) => mapping.targetId),
  );
  const trackedMappings = trackedTargetRefs
    .map((targetRef) => cleanTargetRef(targetRef))
    .filter((targetRef) => !operationTargetIds.has(targetRef.targetId))
    .map((targetRef) => mappedTargetRef(
      plan,
      baseIndex,
      nextIndex,
      patches,
      targetRef,
      true,
    ));
  const targetMappings = [...operationMappings, ...trackedMappings];
  const refreshedTargetRefs = operationMappings.map(
    (mapping) => mapping.afterTargetRef,
  );
  const refreshedTrackedTargetRefs = trackedMappings.map(
    (mapping) => mapping.afterTargetRef,
  );
  const reorderMap = reorderIdentityMap(plan, baseIndex, nextIndex);
  const inverseProvenance = {
    baseSourceSha256: actualSourceSha256,
    outputSourceSha256: nextSourceSha256,
    operationType: authorization.operationType,
    appliedPatches: patches.map((patch) => ({ ...patch })),
  };
  inverseProvenance.token = inverseProvenanceToken(
    inverseProvenance,
    refreshedTargetRefs,
  );
  const inversePlan = {
    version: 1,
    type: `inverse:${plan.type}`,
    sourceSha256: nextSourceSha256,
    patches: inversePatches(patches),
    targetRefs: refreshedTargetRefs,
    trackedTargetRefs: refreshedTrackedTargetRefs,
    metadata: {
      inverseOfSourceSha256: plan.sourceSha256,
      originalType: plan.type,
      operationType: authorization.operationType,
      ...plan.metadata,
      ...mirroredReorderMetadata(plan, reorderMap),
      inverseProvenance,
    },
  };
  registerTrustedInversePlan(inversePlan);
  return {
    html,
    changed: patches.length > 0,
    sourceSha256: nextSourceSha256,
    previousSourceSha256: actualSourceSha256,
    patches,
    inversePlan,
    refreshedTargetRefs,
    refreshedTrackedTargetRefs,
    targetMappings,
    scopeReport: {
      ...scopeReport,
      baseSha256: actualSourceSha256,
      outputSha256: nextSourceSha256,
    },
    parseIntegrity,
    sourceIndex: nextIndex,
  };
}

export class SourcePatchEngine {
  plan(command, indexOrHtml) {
    return planSourcePatch(command, indexOrHtml);
  }

  apply(plan, sourceHtml, options = {}) {
    return applyPatchPlan(plan, sourceHtml, options);
  }
}
