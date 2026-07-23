import { SOURCE_NODE_ATTRIBUTE } from "./source-index.js";
import {
  isTransparentSourceTextElement,
  textRangeToSourceEdit,
} from "./source-text-map.js";
import { RUNTIME_NODE_ATTRIBUTE } from "./runtime-dom-source-map.js";
import {
  NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS,
  NATIVE_EDIT_FORMAT_SKELETON_ROOT_ATTRIBUTES,
} from "./native-edit-policy.js";

export const FORMAT_SKELETON_VERSION = 1;

export const FORMAT_SKELETON_CRITICAL_STYLES = Object.freeze([
  "font-weight",
  "font-style",
  "font-size",
  "color",
  "background-color",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
]);

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const DISPOSABLE_FORMAT_TAGS = new Set(
  NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS,
);

const RUNTIME_ONLY_ATTRIBUTES = new Set([
  SOURCE_NODE_ATTRIBUTE,
  RUNTIME_NODE_ATTRIBUTE,
  "contenteditable",
  "spellcheck",
]);

// FormatSkeleton is captured immediately before NativeEditingController owns
// the root and is validated while that same edit session is active. These
// attributes are PageRoot/controller metadata added to the editable root in
// between those two moments; they are not authored HTML. Keep the exception
// root-only so an authored aria/data/role attribute on an inline descendant
// remains protected byte-for-byte.
const EDIT_SESSION_ROOT_ATTRIBUTES = new Set(
  NATIVE_EDIT_FORMAT_SKELETON_ROOT_ATTRIBUTES,
);

const STYLE_PROPERTY_TO_CAMEL = Object.freeze({
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
  "font-size": "fontSize",
  color: "color",
  "background-color": "backgroundColor",
  "text-decoration-line": "textDecorationLine",
  "text-decoration-style": "textDecorationStyle",
  "text-decoration-color": "textDecorationColor",
});

export class FormatSkeletonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FormatSkeletonError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FormatSkeletonError(code, message, details);
}

function invalid(code, reason, details = {}) {
  return {
    ok: false,
    code,
    reason,
    details,
    patch: null,
  };
}

function isSourceIndex(value) {
  return Boolean(
    value
    && typeof value.source === "string"
    && typeof value.sourceSha256 === "string"
    && value.byNodeId instanceof Map,
  );
}

function assertSourceMap(value) {
  if (
    !value
    || typeof value.sourceSha256 !== "string"
    || typeof value.rootNodeId !== "string"
    || typeof value.text !== "string"
    || !Array.isArray(value.runs)
    || !Array.isArray(value.inlineRanges)
  ) {
    fail("INVALID_FORMAT_SOURCE_MAP", "A complete SourceTextMap is required.");
  }
}

function isUtf16Boundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff);
}

function assertTextRange(value, startOffset, endOffset, codePrefix = "FORMAT_EDIT") {
  if (
    !Number.isInteger(startOffset)
    || !Number.isInteger(endOffset)
    || startOffset < 0
    || endOffset < startOffset
    || endOffset > value.length
  ) {
    fail(
      `${codePrefix}_RANGE_INVALID`,
      "The logical text range is outside the format skeleton.",
      { startOffset, endOffset, textLength: value.length },
    );
  }
  if (!isUtf16Boundary(value, startOffset) || !isUtf16Boundary(value, endOffset)) {
    fail(
      `${codePrefix}_UTF16_BOUNDARY_UNSAFE`,
      "The logical text range splits a UTF-16 surrogate pair.",
      { startOffset, endOffset },
    );
  }
}

function elementTagName(node) {
  return String(node?.localName ?? node?.tagName ?? "").toLowerCase();
}

function isTextNode(node) {
  return node?.nodeType === 3
    || (
      typeof node?.data === "string"
      && !elementTagName(node)
    );
}

function isCommentNode(node) {
  return node?.nodeType === 8;
}

function textNodeValue(node) {
  if (typeof node?.data === "string") return node.data;
  if (typeof node?.nodeValue === "string") return node.nodeValue;
  return "";
}

function childNodes(node) {
  return Array.from(node?.childNodes ?? []);
}

function attributeEntries(node) {
  const attributes = node?.attributes;
  if (!attributes) return [];
  if (attributes instanceof Map) {
    return [...attributes.entries()].map(([name, value]) => ({ name, value }));
  }
  return Array.from(attributes).map((attribute) => ({
    name: attribute?.name ?? attribute?.nodeName ?? "",
    value: attribute?.value ?? attribute?.nodeValue ?? "",
  }));
}

function normalizedDomAttributes(node, ignoreEditSessionRootAttributes = false) {
  return attributeEntries(node)
    .map(({ name, value }) => ({
      name: String(name).toLowerCase(),
      value: String(value),
    }))
    .filter(({ name }) => (
      name
      && !RUNTIME_ONLY_ATTRIBUTES.has(name)
      && (
        !ignoreEditSessionRootAttributes
        || !EDIT_SESSION_ROOT_ATTRIBUTES.has(name)
      )
    ))
    .sort((left, right) => (
      left.name.localeCompare(right.name) || left.value.localeCompare(right.value)
    ));
}

function sameAttributes(left, right) {
  return left.length === right.length && left.every((attribute, index) => (
    attribute.name === right[index].name
    && attribute.value === right[index].value
  ));
}

function sourceAttributes(element) {
  return element.attributes.map((attribute) => ({
    name: attribute.name,
    value: attribute.value ?? attribute.rawValue ?? null,
    rawValue: attribute.rawValue,
    raw: attribute.raw,
    range: { ...attribute.range },
    nameRange: { ...attribute.nameRange },
    valueRange: attribute.valueRange ? { ...attribute.valueRange } : null,
  }));
}

function sourceProtectedRanges(element) {
  const ranges = [{
    nodeId: element.nodeId,
    kind: "start-tag",
    startOffset: element.startTagRange.startOffset,
    endOffset: element.startTagRange.endOffset,
    raw: element.startTagRaw,
  }];
  if (element.endTagRange) {
    ranges.push({
      nodeId: element.nodeId,
      kind: "end-tag",
      startOffset: element.endTagRange.startOffset,
      endOffset: element.endTagRange.endOffset,
      raw: element.endTagRaw,
    });
  }
  return ranges;
}

function getStyleReader(root, supplied) {
  if (typeof supplied === "function") return supplied;
  const reader = root?.ownerDocument?.defaultView?.getComputedStyle;
  if (typeof reader === "function") {
    return (node) => reader.call(root.ownerDocument.defaultView, node);
  }
  return null;
}

function styleValue(style, property) {
  if (!style) return "";
  const fromGetter = typeof style.getPropertyValue === "function"
    ? style.getPropertyValue(property)
    : undefined;
  const camelName = STYLE_PROPERTY_TO_CAMEL[property];
  const value = fromGetter || style[property] || (camelName ? style[camelName] : "");
  return String(value ?? "").trim().replace(/[\t\n\f\r ]+/g, " ");
}

function criticalStyleSnapshot(node, reader) {
  if (!reader) return null;
  const style = reader(node);
  return Object.fromEntries(
    FORMAT_SKELETON_CRITICAL_STYLES.map((property) => [
      property,
      styleValue(style, property),
    ]),
  );
}

function sameCriticalStyle(left, right) {
  if (left === null || right === null) return left === right;
  return FORMAT_SKELETON_CRITICAL_STYLES.every(
    (property) => left[property] === right[property],
  );
}

function sourceNodeIdForElement(node, runtimeMap) {
  const binding = typeof runtimeMap?.bindingForNode === "function"
    ? runtimeMap.bindingForNode(node)
    : null;
  if (binding?.kind === "element" && binding.sourceNodeId) {
    return String(binding.sourceNodeId);
  }
  if (typeof node?.getAttribute === "function") {
    const value = node.getAttribute(SOURCE_NODE_ATTRIBUTE);
    return value ? String(value) : null;
  }
  const attribute = attributeEntries(node).find(
    ({ name }) => String(name).toLowerCase() === SOURCE_NODE_ATTRIBUTE,
  );
  return attribute ? String(attribute.value) : null;
}

function analyzeDom(root, options = {}) {
  if (!root || !elementTagName(root)) {
    return invalid(
      "FORMAT_DOM_ROOT_REQUIRED",
      "A live authored DOM root is required for format validation.",
    );
  }
  const runtimeMap = options.runtimeMap ?? null;
  const styleReader = getStyleReader(root, options.getComputedStyle);
  const elements = [];
  const textNodes = [];
  const errors = [];
  let text = "";

  const visit = (node, path, isRoot = false) => {
    if (isTextNode(node)) {
      const value = textNodeValue(node);
      const textStart = text.length;
      text += value;
      textNodes.push({
        node,
        path,
        text: value,
        textStart,
        textEnd: text.length,
      });
      return;
    }
    if (isCommentNode(node)) {
      errors.push({
        code: "FORMAT_DOM_COMMENT_UNSAFE",
        path,
      });
      return;
    }

    const tagName = elementTagName(node);
    if (!tagName) {
      errors.push({ code: "FORMAT_DOM_NODE_UNSUPPORTED", path });
      return;
    }
    const record = {
      node,
      path,
      tagName,
      sourceNodeId: sourceNodeIdForElement(node, runtimeMap),
      attributes: normalizedDomAttributes(node, isRoot),
      criticalStyle: criticalStyleSnapshot(node, styleReader),
      textStart: text.length,
      textEnd: text.length,
      isRoot,
      placeholderBreak: false,
    };
    elements.push(record);

    if (!isRoot && tagName === "br") {
      const isOnlyEmptyChild = options.allowPlaceholderBreak !== false
        && childNodes(root).length === 1
        && childNodes(node).length === 0;
      if (!record.sourceNodeId && isOnlyEmptyChild) {
        record.placeholderBreak = true;
      } else {
        text += "\n";
      }
      record.textEnd = text.length;
      return;
    }
    if (!isRoot && !isTransparentSourceTextElement(tagName)) {
      errors.push({
        code: "FORMAT_DOM_BLOCK_BOUNDARY",
        path,
        tagName,
      });
      return;
    }
    childNodes(node).forEach((child, index) => visit(child, `${path}.${index}`));
    record.textEnd = text.length;
  };

  visit(root, "0", true);
  return {
    ok: errors.length === 0,
    code: errors[0]?.code ?? null,
    reason: errors.length > 0
      ? "The final DOM contains structure outside the format-safe text island."
      : null,
    details: errors.length > 0 ? { errors } : {},
    text,
    elements,
    textNodes,
    styleReaderAvailable: Boolean(styleReader),
  };
}

function canonicalSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    if (segment.endOffset <= segment.startOffset) continue;
    const previous = merged.at(-1);
    if (
      previous
      && previous.textNodeId === segment.textNodeId
      && previous.endOffset === segment.startOffset
    ) {
      previous.endOffset = segment.endOffset;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function verifyRuntimeTextBindings(sourceMap, analysis, runtimeMap) {
  if (!runtimeMap || typeof runtimeMap.bindingForNode !== "function") {
    fail(
      "FORMAT_RUNTIME_MAP_REQUIRED",
      "FormatSkeleton capture requires the active RuntimeDomSourceMap.",
    );
  }
  const actual = [];
  for (const record of analysis.textNodes) {
    if (record.text.length === 0) continue;
    const binding = runtimeMap.bindingForNode(record.node);
    if (binding?.kind !== "text" || binding.complete !== true) {
      fail(
        "FORMAT_RUNTIME_TEXT_MAPPING_INCOMPLETE",
        "Every authored DOM text node must have a complete runtime source binding.",
        { path: record.path },
      );
    }
    for (const span of binding.spans) {
      actual.push({
        textNodeId: span.textNodeId,
        startOffset: span.sourceStartOffset,
        endOffset: span.sourceEndOffset,
      });
    }
  }
  const expected = sourceMap.runs
    .filter((run) => run.kind === "text" && run.text.length > 0)
    .map((run) => ({
      textNodeId: run.textNodeId,
      startOffset: 0,
      endOffset: run.text.length,
    }));
  const normalizedActual = canonicalSegments(actual);
  const normalizedExpected = canonicalSegments(expected);
  const matches = normalizedActual.length === normalizedExpected.length
    && normalizedActual.every((segment, index) => (
      segment.textNodeId === normalizedExpected[index].textNodeId
      && segment.startOffset === normalizedExpected[index].startOffset
      && segment.endOffset === normalizedExpected[index].endOffset
    ));
  if (!matches) {
    fail(
      "FORMAT_RUNTIME_TEXT_MAPPING_MISMATCH",
      "The runtime text sequence does not match the SourceTextMap.",
      { expected: normalizedExpected, actual: normalizedActual },
    );
  }
}

function verifyRuntimeElementBinding(runtimeMap, record, expectedNodeId) {
  const binding = typeof runtimeMap?.bindingForNode === "function"
    ? runtimeMap.bindingForNode(record.node)
    : null;
  if (
    binding?.kind !== "element"
    || binding.sourceNodeId !== expectedNodeId
  ) {
    fail(
      "FORMAT_RUNTIME_ELEMENT_MAPPING_MISMATCH",
      "An authored DOM element does not have the expected runtime source binding.",
      {
        path: record.path,
        expectedNodeId,
        actualNodeId: binding?.kind === "element" ? binding.sourceNodeId : null,
      },
    );
  }
}

function compareWrapperOrder(left, right) {
  return left.sourceStart - right.sourceStart
    || right.sourceEnd - left.sourceEnd
    || left.depth - right.depth
    || left.nodeId.localeCompare(right.nodeId);
}

function disposableSourceWrapper(element) {
  return Boolean(
    element?.type === "element"
    && element.namespaceURI === HTML_NAMESPACE
    && DISPOSABLE_FORMAT_TAGS.has(element.tagName)
    && element.attributes.every((attribute) => attribute.name === "style")
    && element.explicitEndTag
    && !element.isVoid
    && element.boundarySafe,
  );
}

function wrapperAncestors(index, rootNodeId, node) {
  const ancestors = [];
  let parentId = node.parentId;
  while (parentId && parentId !== rootNodeId) {
    const parent = index.byNodeId.get(parentId);
    if (!parent || parent.type !== "element") break;
    if (isTransparentSourceTextElement(parent.tagName)) ancestors.unshift(parent.nodeId);
    parentId = parent.parentId;
  }
  return ancestors;
}

function descendantTextNodeIds(index, element) {
  const result = [];
  const visit = (node) => {
    if (node?.type === "text") {
      result.push(node.nodeId);
      return;
    }
    if (node?.type !== "element") return;
    for (const childId of node.childIds) visit(index.byNodeId.get(childId));
  };
  visit(element);
  return result;
}

function sourceWrapperRecord(index, range, domRecord) {
  const element = index.byNodeId.get(range.nodeId);
  if (!element || element.type !== "element") {
    fail(
      "FORMAT_SOURCE_WRAPPER_MISSING",
      "A SourceTextMap inline range is missing from the SourceIndex.",
      { nodeId: range.nodeId },
    );
  }
  return {
    nodeId: element.nodeId,
    parentNodeId: element.parentId,
    parentWrapperNodeId: wrapperAncestors(index, range.rootNodeId, element).at(-1) ?? null,
    ancestorWrapperNodeIds: wrapperAncestors(index, range.rootNodeId, element),
    descendantTextNodeIds: descendantTextNodeIds(index, element),
    tagName: element.tagName,
    depth: range.depth,
    textStart: range.textStart,
    textEnd: range.textEnd,
    sourceStart: element.range.startOffset,
    sourceEnd: element.range.endOffset,
    sourceAttributes: sourceAttributes(element),
    domAttributes: domRecord.attributes,
    criticalStyle: domRecord.criticalStyle,
    disposable: disposableSourceWrapper(element),
    link: element.tagName === "a",
    href: element.attributesByName.get("href")?.[0]?.value
      ?? element.attributesByName.get("href")?.[0]?.rawValue
      ?? null,
    protectedSourceRanges: sourceProtectedRanges(element),
  };
}

function sourceHardBreakRecord(index, run, domRecord) {
  const element = index.byNodeId.get(run.nodeId);
  if (!element || element.type !== "element") {
    fail(
      "FORMAT_SOURCE_HARD_BREAK_MISSING",
      "A SourceTextMap hard break is missing from the SourceIndex.",
      { nodeId: run.nodeId },
    );
  }
  if (element.tagName !== "br" || run.tagName !== "br") {
    fail(
      "FORMAT_SOURCE_HARD_BREAK_TAG_MISMATCH",
      "A SourceTextMap hard break must resolve to an authored br element.",
      {
        nodeId: run.nodeId,
        sourceTagName: element.tagName,
        mapTagName: run.tagName,
      },
    );
  }
  if (element.parentId !== run.parentNodeId) {
    fail(
      "FORMAT_SOURCE_HARD_BREAK_PARENT_MISMATCH",
      "The hard break parent differs between the SourceIndex and SourceTextMap.",
      {
        nodeId: run.nodeId,
        sourceParentNodeId: element.parentId,
        mapParentNodeId: run.parentNodeId,
      },
    );
  }
  return {
    kind: "hard-break",
    nodeId: element.nodeId,
    parentNodeId: element.parentId,
    tagName: element.tagName,
    textStart: run.textStart,
    textEnd: run.textEnd,
    sourceStart: element.range.startOffset,
    sourceEnd: element.range.endOffset,
    sourceAttributes: sourceAttributes(element),
    domAttributes: domRecord.attributes,
    protectedSourceRanges: sourceProtectedRanges(element),
  };
}

/**
 * Capture a source-owned formatting skeleton for one native text island.
 * The result is plain data: DOM nodes and innerHTML never become source input.
 */
export function captureFormatSkeleton(index, sourceMap, options = {}) {
  if (!isSourceIndex(index)) {
    fail("INVALID_FORMAT_SOURCE_INDEX", "FormatSkeleton requires an existing SourceIndex.");
  }
  assertSourceMap(sourceMap);
  if (index.sourceSha256 !== sourceMap.sourceSha256) {
    fail(
      "FORMAT_SOURCE_REVISION_MISMATCH",
      "The SourceIndex and SourceTextMap belong to different source revisions.",
      {
        indexSourceSha256: index.sourceSha256,
        mapSourceSha256: sourceMap.sourceSha256,
      },
    );
  }
  const rootSource = index.byNodeId.get(sourceMap.rootNodeId);
  if (!rootSource || rootSource.type !== "element") {
    fail(
      "FORMAT_SOURCE_ROOT_MISSING",
      "The SourceTextMap root is missing from the SourceIndex.",
      { rootNodeId: sourceMap.rootNodeId },
    );
  }

  const analysis = analyzeDom(options.root, {
    runtimeMap: options.runtimeMap,
    getComputedStyle: options.getComputedStyle,
    allowPlaceholderBreak: false,
  });
  if (!analysis.ok) {
    fail(analysis.code, analysis.reason, analysis.details);
  }
  if (analysis.text !== sourceMap.text) {
    fail(
      "FORMAT_BASELINE_TEXT_MISMATCH",
      "The live DOM text does not match the source text projection.",
      { sourceText: sourceMap.text, domText: analysis.text },
    );
  }
  verifyRuntimeTextBindings(sourceMap, analysis, options.runtimeMap);

  const rootDom = analysis.elements[0];
  if (
    rootDom.tagName !== rootSource.tagName
    || (rootDom.sourceNodeId && rootDom.sourceNodeId !== rootSource.nodeId)
  ) {
    fail(
      "FORMAT_RUNTIME_ROOT_MISMATCH",
      "The live DOM root does not match the source text host.",
      {
        expectedNodeId: rootSource.nodeId,
        actualNodeId: rootDom.sourceNodeId,
        expectedTagName: rootSource.tagName,
        actualTagName: rootDom.tagName,
      },
    );
  }
  verifyRuntimeElementBinding(options.runtimeMap, rootDom, rootSource.nodeId);

  const domBySourceId = new Map();
  for (const record of analysis.elements) {
    if (!record.sourceNodeId) continue;
    const group = domBySourceId.get(record.sourceNodeId) ?? [];
    group.push(record);
    domBySourceId.set(record.sourceNodeId, group);
  }

  const wrappers = sourceMap.inlineRanges.map((range) => {
    const candidates = domBySourceId.get(range.nodeId) ?? [];
    if (candidates.length !== 1) {
      fail(
        "FORMAT_RUNTIME_WRAPPER_IDENTITY_MISMATCH",
        "Each authored inline wrapper must resolve to exactly one live DOM element.",
        { nodeId: range.nodeId, matchCount: candidates.length },
      );
    }
    const domRecord = candidates[0];
    const sourceElement = index.byNodeId.get(range.nodeId);
    if (domRecord.tagName !== sourceElement?.tagName) {
      fail(
        "FORMAT_RUNTIME_WRAPPER_TAG_MISMATCH",
        "The live authored wrapper tag does not match its source element.",
        {
          nodeId: range.nodeId,
          expectedTagName: sourceElement?.tagName,
          actualTagName: domRecord.tagName,
        },
      );
    }
    verifyRuntimeElementBinding(options.runtimeMap, domRecord, range.nodeId);
    if (domRecord.textStart !== range.textStart || domRecord.textEnd !== range.textEnd) {
      fail(
        "FORMAT_RUNTIME_WRAPPER_COVERAGE_MISMATCH",
        "The live authored wrapper covers a different text interval than the source.",
        {
          nodeId: range.nodeId,
          sourceRange: [range.textStart, range.textEnd],
          domRange: [domRecord.textStart, domRecord.textEnd],
        },
      );
    }
    return sourceWrapperRecord(
      index,
      { ...range, rootNodeId: sourceMap.rootNodeId },
      domRecord,
    );
  }).sort(compareWrapperOrder);

  const hardBreaks = sourceMap.runs
    .filter((run) => run.kind === "hard-break")
    .map((run) => {
      const candidates = domBySourceId.get(run.nodeId) ?? [];
      if (candidates.length !== 1) {
        fail(
          "FORMAT_RUNTIME_HARD_BREAK_IDENTITY_MISMATCH",
          "Each authored hard break must resolve to exactly one live DOM element.",
          { nodeId: run.nodeId, matchCount: candidates.length },
        );
      }
      const domRecord = candidates[0];
      if (domRecord.tagName !== "br") {
        fail(
          "FORMAT_RUNTIME_HARD_BREAK_TAG_MISMATCH",
          "The live authored hard break is not a br element.",
          {
            nodeId: run.nodeId,
            expectedTagName: "br",
            actualTagName: domRecord.tagName,
          },
        );
      }
      verifyRuntimeElementBinding(options.runtimeMap, domRecord, run.nodeId);
      const parentNodeId = sourceNodeIdForElement(
        domRecord.node?.parentNode,
        options.runtimeMap,
      );
      if (parentNodeId !== run.parentNodeId) {
        fail(
          "FORMAT_RUNTIME_HARD_BREAK_PARENT_MISMATCH",
          "The live authored hard break is attached to a different source parent.",
          {
            nodeId: run.nodeId,
            expectedParentNodeId: run.parentNodeId,
            actualParentNodeId: parentNodeId,
          },
        );
      }
      if (domRecord.textStart !== run.textStart || domRecord.textEnd !== run.textEnd) {
        fail(
          "FORMAT_RUNTIME_HARD_BREAK_COVERAGE_MISMATCH",
          "The live authored hard break covers a different logical text interval.",
          {
            nodeId: run.nodeId,
            sourceRange: [run.textStart, run.textEnd],
            domRange: [domRecord.textStart, domRecord.textEnd],
          },
        );
      }
      return sourceHardBreakRecord(index, run, domRecord);
    });

  const knownNodeIds = new Set([
    sourceMap.rootNodeId,
    ...wrappers.map(({ nodeId }) => nodeId),
    ...hardBreaks.map(({ nodeId }) => nodeId),
  ]);
  const unexpectedAuthored = analysis.elements.filter((record) => (
    !record.isRoot
    && record.sourceNodeId
    && !knownNodeIds.has(record.sourceNodeId)
    && !record.placeholderBreak
  ));
  if (unexpectedAuthored.length > 0) {
    fail(
      "FORMAT_RUNTIME_STRUCTURE_OUTSIDE_SOURCE_MAP",
      "The live DOM contains authored structure outside the SourceTextMap.",
      { nodeIds: unexpectedAuthored.map(({ sourceNodeId }) => sourceNodeId) },
    );
  }

  const sourceSegments = sourceMap.runs.map((run) => ({
    kind: run.kind,
    nodeId: run.kind === "text" ? run.textNodeId : run.nodeId,
    textStart: run.textStart,
    textEnd: run.textEnd,
    sourceStart: run.sourceStart,
    sourceEnd: run.sourceEnd,
    decodedText: run.kind === "text" ? run.text : sourceMap.text.slice(run.textStart, run.textEnd),
    raw: index.source.slice(run.sourceStart, run.sourceEnd),
  }));
  const rootRecord = {
    nodeId: rootSource.nodeId,
    tagName: rootSource.tagName,
    sourceStart: rootSource.range.startOffset,
    sourceEnd: rootSource.range.endOffset,
    sourceAttributes: sourceAttributes(rootSource),
    domAttributes: rootDom.attributes,
    criticalStyle: rootDom.criticalStyle,
    protectedSourceRanges: sourceProtectedRanges(rootSource),
  };
  const protectedSourceRanges = [
    ...rootRecord.protectedSourceRanges,
    ...wrappers.flatMap((wrapper) => wrapper.protectedSourceRanges),
    ...hardBreaks.flatMap((hardBreak) => hardBreak.protectedSourceRanges),
  ].sort((left, right) => (
    left.startOffset - right.startOffset
    || left.endOffset - right.endOffset
    || left.kind.localeCompare(right.kind)
  ));

  return {
    version: FORMAT_SKELETON_VERSION,
    sourceSha256: index.sourceSha256,
    rootNodeId: sourceMap.rootNodeId,
    rootTagName: sourceMap.rootTagName,
    text: sourceMap.text,
    textLength: sourceMap.textLength,
    sourceMap,
    sourceSegments,
    root: rootRecord,
    wrappers,
    hardBreaks,
    linkBoundaries: wrappers
      .filter((wrapper) => wrapper.link)
      .map((wrapper) => ({
        nodeId: wrapper.nodeId,
        textStart: wrapper.textStart,
        textEnd: wrapper.textEnd,
        href: wrapper.href,
      })),
    protectedSourceRanges,
    criticalStylesCaptured: analysis.styleReaderAvailable,
  };
}

function deriveEditRange(before, after) {
  if (before === after) {
    return { startOffset: 0, endOffset: 0 };
  }
  let startOffset = 0;
  while (
    startOffset < before.length
    && startOffset < after.length
    && before[startOffset] === after[startOffset]
  ) {
    startOffset += 1;
  }
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > startOffset
    && afterEnd > startOffset
    && before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return { startOffset, endOffset: beforeEnd };
}

function replacementForRange(before, after, editRange) {
  const prefix = before.slice(0, editRange.startOffset);
  const suffix = before.slice(editRange.endOffset);
  if (
    after.length < prefix.length + suffix.length
    || !after.startsWith(prefix)
    || !after.endsWith(suffix)
  ) {
    return null;
  }
  return after.slice(prefix.length, after.length - suffix.length);
}

function wrapperStackForSourceAnchor(skeleton, anchor) {
  if (anchor.kind === "text") {
    return skeleton.wrappers
      .filter((wrapper) => wrapper.descendantTextNodeIds.includes(anchor.textNodeId))
      .sort((left, right) => left.depth - right.depth || compareWrapperOrder(left, right));
  }
  const parentWrapper = skeleton.wrappers.find(
    (wrapper) => wrapper.nodeId === anchor.parentNodeId,
  );
  if (!parentWrapper) return [];
  const nodeIds = new Set([
    ...parentWrapper.ancestorWrapperNodeIds,
    parentWrapper.nodeId,
  ]);
  return skeleton.wrappers
    .filter((wrapper) => nodeIds.has(wrapper.nodeId))
    .sort((left, right) => left.depth - right.depth || compareWrapperOrder(left, right));
}

function linkBoundaryViolation(skeleton, startOffset, endOffset) {
  const links = skeleton.linkBoundaries;
  if (startOffset === endOffset) {
    const boundary = links.find((link) => (
      startOffset === link.textStart || startOffset === link.textEnd
    ));
    if (boundary) {
      return {
        code: "FORMAT_LINK_BOUNDARY_AMBIGUOUS",
        reason: "A collapsed edit at a link boundary has ambiguous source ownership.",
        details: { nodeId: boundary.nodeId, offset: startOffset },
      };
    }
    return null;
  }
  const intersected = links.filter((link) => (
    startOffset < link.textEnd && endOffset > link.textStart
  ));
  if (intersected.length === 0) return null;
  if (
    intersected.length === 1
    && startOffset >= intersected[0].textStart
    && endOffset <= intersected[0].textEnd
  ) {
    return null;
  }
  return {
    code: "FORMAT_CROSS_LINK_EDIT",
    reason: "A native text replacement cannot cross a link boundary.",
    details: {
      startOffset,
      endOffset,
      linkNodeIds: intersected.map(({ nodeId }) => nodeId),
    },
  };
}

function projectedOutsideFragments(wrapper, editRange, replacementLength) {
  const removedLength = editRange.endOffset - editRange.startOffset;
  const delta = replacementLength - removedLength;
  const fragments = [];
  if (wrapper.textStart < editRange.startOffset) {
    const endOffset = Math.min(wrapper.textEnd, editRange.startOffset);
    if (endOffset > wrapper.textStart) {
      fragments.push({
        startOffset: wrapper.textStart,
        endOffset,
      });
    }
  }
  if (wrapper.textEnd > editRange.endOffset) {
    const startOffset = Math.max(wrapper.textStart, editRange.endOffset) + delta;
    const endOffset = wrapper.textEnd + delta;
    if (endOffset > startOffset) fragments.push({ startOffset, endOffset });
  }
  return fragments;
}

function wrapperFullyCovered(wrapper, editRange) {
  return editRange.startOffset < editRange.endOffset
    && editRange.startOffset <= wrapper.textStart
    && editRange.endOffset >= wrapper.textEnd;
}

function wrapperIntersects(wrapper, editRange) {
  if (editRange.startOffset === editRange.endOffset) {
    return editRange.startOffset >= wrapper.textStart
      && editRange.startOffset <= wrapper.textEnd;
  }
  return editRange.startOffset < wrapper.textEnd
    && editRange.endOffset > wrapper.textStart;
}

function exactProjectedRange(wrapper, editRange, replacementLength) {
  const delta = replacementLength - (editRange.endOffset - editRange.startOffset);
  if (wrapper.textEnd <= editRange.startOffset) {
    return { startOffset: wrapper.textStart, endOffset: wrapper.textEnd };
  }
  if (wrapper.textStart >= editRange.endOffset) {
    return {
      startOffset: wrapper.textStart + delta,
      endOffset: wrapper.textEnd + delta,
    };
  }
  return null;
}

function observedBySourceId(analysis) {
  const result = new Map();
  for (const record of analysis.elements) {
    if (!record.sourceNodeId) continue;
    const group = result.get(record.sourceNodeId) ?? [];
    group.push(record);
    result.set(record.sourceNodeId, group);
  }
  return result;
}

function validateHardBreaks(skeleton, observed, runtimeMap, projectRange) {
  for (const hardBreak of skeleton.hardBreaks) {
    const matches = observed.get(hardBreak.nodeId) ?? [];
    if (matches.length > 1) {
      return invalid(
        "FORMAT_HARD_BREAK_IDENTITY_DUPLICATED",
        "An authored hard break was duplicated during native editing.",
        { nodeId: hardBreak.nodeId, matchCount: matches.length },
      );
    }
    if (matches.length === 0) {
      return invalid(
        "FORMAT_HARD_BREAK_REMOVED",
        "An authored hard break was removed or lost its source identity.",
        { nodeId: hardBreak.nodeId },
      );
    }

    const current = matches[0];
    if (current.tagName !== hardBreak.tagName) {
      return invalid(
        "FORMAT_HARD_BREAK_TAG_CHANGED",
        "An authored hard break changed tag name.",
        {
          nodeId: hardBreak.nodeId,
          expectedTagName: hardBreak.tagName,
          actualTagName: current.tagName,
        },
      );
    }
    if (!sameAttributes(hardBreak.domAttributes, current.attributes)) {
      return invalid(
        "FORMAT_HARD_BREAK_ATTRIBUTES_CHANGED",
        "An authored hard break changed class, style, or another attribute.",
        { nodeId: hardBreak.nodeId },
      );
    }
    if (runtimeMap && typeof runtimeMap.bindingForNode === "function") {
      const binding = runtimeMap.bindingForNode(current.node);
      if (
        binding?.kind !== "element"
        || binding.sourceNodeId !== hardBreak.nodeId
      ) {
        return invalid(
          "FORMAT_HARD_BREAK_RUNTIME_MAPPING_CHANGED",
          "The authored hard break no longer has its captured runtime source binding.",
          {
            nodeId: hardBreak.nodeId,
            actualNodeId: binding?.kind === "element" ? binding.sourceNodeId : null,
          },
        );
      }
    }
    const parentNodeId = sourceNodeIdForElement(current.node?.parentNode, runtimeMap);
    if (parentNodeId !== hardBreak.parentNodeId) {
      return invalid(
        "FORMAT_HARD_BREAK_PARENT_CHANGED",
        "An authored hard break moved to a different source parent.",
        {
          nodeId: hardBreak.nodeId,
          expectedParentNodeId: hardBreak.parentNodeId,
          actualParentNodeId: parentNodeId,
        },
      );
    }

    const expectedRange = projectRange(hardBreak);
    if (
      !expectedRange
      || current.textStart !== expectedRange.startOffset
      || current.textEnd !== expectedRange.endOffset
    ) {
      return invalid(
        "FORMAT_HARD_BREAK_COVERAGE_CHANGED",
        "An authored hard break moved outside its projected logical text interval.",
        {
          nodeId: hardBreak.nodeId,
          expected: expectedRange,
          actual: { startOffset: current.textStart, endOffset: current.textEnd },
        },
      );
    }
  }
  return null;
}

function validateFinalSelection(selection, finalText) {
  if (!selection) return null;
  const anchor = Number(selection.anchor ?? selection.anchorOffset);
  const focus = Number(selection.focus ?? selection.focusOffset);
  if (
    !Number.isInteger(anchor)
    || !Number.isInteger(focus)
    || anchor < 0
    || focus < 0
    || anchor > finalText.length
    || focus > finalText.length
    || !isUtf16Boundary(finalText, anchor)
    || !isUtf16Boundary(finalText, focus)
  ) {
    return invalid(
      "FORMAT_FINAL_SELECTION_INVALID",
      "The final logical Selection is outside the stable text value.",
      { anchor, focus, textLength: finalText.length },
    );
  }
  return { anchor, focus };
}

/**
 * Validate one stable final DOM value against a captured source skeleton.
 * The returned patch is a SourcePatch description, never serialized DOM.
 */
export function validateFormatSkeletonEdit(skeleton, options = {}) {
  if (
    !skeleton
    || skeleton.version !== FORMAT_SKELETON_VERSION
    || typeof skeleton.text !== "string"
    || !Array.isArray(skeleton.wrappers)
    || !Array.isArray(skeleton.hardBreaks)
    || !skeleton.sourceMap
  ) {
    fail("INVALID_FORMAT_SKELETON", "A captured FormatSkeleton is required.");
  }
  if (
    options.expectedSourceSha256
    && options.expectedSourceSha256 !== skeleton.sourceSha256
  ) {
    return invalid(
      "FORMAT_SOURCE_REVISION_STALE",
      "The source revision changed after this format skeleton was captured.",
      {
        expectedSourceSha256: options.expectedSourceSha256,
        skeletonSourceSha256: skeleton.sourceSha256,
      },
    );
  }

  const analysis = analyzeDom(options.root, {
    runtimeMap: options.runtimeMap,
    getComputedStyle: options.getComputedStyle,
    allowPlaceholderBreak: options.allowPlaceholderBreak,
  });
  if (!analysis.ok) return invalid(analysis.code, analysis.reason, analysis.details);
  const finalText = analysis.text;

  const suppliedRange = options.editRange ?? null;
  const editRange = suppliedRange
    ? {
        startOffset: Number(suppliedRange.startOffset),
        endOffset: Number(suppliedRange.endOffset),
      }
    : deriveEditRange(skeleton.text, finalText);
  try {
    assertTextRange(
      skeleton.text,
      editRange.startOffset,
      editRange.endOffset,
      "FORMAT_EDIT",
    );
  } catch (error) {
    if (!(error instanceof FormatSkeletonError)) throw error;
    return invalid(error.code, error.message, error.details);
  }

  const replacementText = replacementForRange(skeleton.text, finalText, editRange);
  if (replacementText === null) {
    return invalid(
      "FORMAT_TEXT_OUTSIDE_EDIT_CHANGED",
      "Text outside the authorized logical replacement changed.",
      {
        startOffset: editRange.startOffset,
        endOffset: editRange.endOffset,
      },
    );
  }
  if (!isUtf16Boundary(replacementText, 0) || !isUtf16Boundary(replacementText, replacementText.length)) {
    return invalid(
      "FORMAT_REPLACEMENT_UTF16_UNSAFE",
      "The replacement text has an unsafe UTF-16 boundary.",
    );
  }

  const selection = validateFinalSelection(options.finalSelection, finalText);
  if (selection?.ok === false) return selection;

  const linkViolation = linkBoundaryViolation(
    skeleton,
    editRange.startOffset,
    editRange.endOffset,
  );
  if (linkViolation) {
    return invalid(linkViolation.code, linkViolation.reason, linkViolation.details);
  }

  let sourceEdit;
  try {
    sourceEdit = textRangeToSourceEdit(
      skeleton.sourceMap,
      editRange.startOffset,
      editRange.endOffset,
      suppliedRange?.affinity ?? "right",
    );
  } catch (error) {
    return invalid(
      "FORMAT_CROSS_BLOCK_EDIT",
      "The replacement crosses source structure outside one text island.",
      {
        causeCode: error?.code ?? null,
        cause: String(error?.message ?? error),
      },
    );
  }

  const affinity = suppliedRange?.affinity === "left" ? "left" : "right";
  const inheritanceStack = wrapperStackForSourceAnchor(skeleton, sourceEdit.insertAt);
  const inheritedWrapperNodeIds = new Set(
    inheritanceStack.map(({ nodeId }) => nodeId),
  );
  const removalEligibleWrapperNodeIds = skeleton.wrappers
    .filter((wrapper) => (
      wrapperFullyCovered(wrapper, editRange)
      && wrapper.disposable
      && (
        replacementText.length === 0
        || !inheritedWrapperNodeIds.has(wrapper.nodeId)
      )
    ))
    .map(({ nodeId }) => nodeId);
  const removalEligibleWrapperIds = new Set(removalEligibleWrapperNodeIds);

  const observed = observedBySourceId(analysis);
  const rootMatches = observed.get(skeleton.rootNodeId) ?? [];
  const finalRoot = analysis.elements[0];
  if (
    finalRoot.tagName !== skeleton.root.tagName
    || (finalRoot.sourceNodeId && finalRoot.sourceNodeId !== skeleton.rootNodeId)
    || rootMatches.length > 1
  ) {
    return invalid(
      "FORMAT_ROOT_IDENTITY_CHANGED",
      "The authored text host changed during native editing.",
      {
        expectedNodeId: skeleton.rootNodeId,
        actualNodeId: finalRoot.sourceNodeId,
        expectedTagName: skeleton.root.tagName,
        actualTagName: finalRoot.tagName,
      },
    );
  }
  if (!sameAttributes(skeleton.root.domAttributes, finalRoot.attributes)) {
    return invalid(
      "FORMAT_ROOT_ATTRIBUTES_CHANGED",
      "The authored text host attributes changed during native editing.",
      { nodeId: skeleton.rootNodeId },
    );
  }
  if (
    skeleton.criticalStylesCaptured
    && !sameCriticalStyle(skeleton.root.criticalStyle, finalRoot.criticalStyle)
  ) {
    return invalid(
      "FORMAT_ROOT_STYLE_CHANGED",
      "The authored text host computed style changed during native editing.",
      { nodeId: skeleton.rootNodeId },
    );
  }

  const hardBreakViolation = validateHardBreaks(
    skeleton,
    observed,
    options.runtimeMap,
    (hardBreak) => exactProjectedRange(hardBreak, editRange, replacementText.length),
  );
  if (hardBreakViolation) return hardBreakViolation;

  const preserveWrapperNodeIds = [];
  const domMissingDisposableWrapperNodeIds = [];
  let canonicalizeDom = removalEligibleWrapperNodeIds.length > 0;

  for (const wrapper of skeleton.wrappers) {
    const matches = observed.get(wrapper.nodeId) ?? [];
    if (matches.length > 1) {
      return invalid(
        "FORMAT_WRAPPER_IDENTITY_DUPLICATED",
        "An authored formatting wrapper was duplicated during native editing.",
        { nodeId: wrapper.nodeId },
      );
    }
    const complete = wrapperFullyCovered(wrapper, editRange);
    const sourceCleanupEligible = removalEligibleWrapperIds.has(wrapper.nodeId);

    if (matches.length === 0) {
      if (complete && wrapper.disposable) {
        domMissingDisposableWrapperNodeIds.push(wrapper.nodeId);
        if (!sourceCleanupEligible) preserveWrapperNodeIds.push(wrapper.nodeId);
        canonicalizeDom = true;
        continue;
      }
      return invalid(
        complete ? "FORMAT_PROTECTED_WRAPPER_REMOVED" : "FORMAT_PARTIAL_WRAPPER_REMOVED",
        "An authored formatting wrapper outside the fully covered disposable set was removed.",
        {
          nodeId: wrapper.nodeId,
          tagName: wrapper.tagName,
          fullyCovered: complete,
          disposable: wrapper.disposable,
        },
      );
    }

    const current = matches[0];
    if (current.tagName !== wrapper.tagName) {
      return invalid(
        "FORMAT_WRAPPER_TAG_CHANGED",
        "An authored formatting wrapper changed tag name.",
        {
          nodeId: wrapper.nodeId,
          expectedTagName: wrapper.tagName,
          actualTagName: current.tagName,
        },
      );
    }
    if (!sameAttributes(wrapper.domAttributes, current.attributes)) {
      return invalid(
        "FORMAT_WRAPPER_ATTRIBUTES_CHANGED",
        "An authored formatting wrapper changed class, style, href, or another attribute.",
        { nodeId: wrapper.nodeId },
      );
    }
    if (
      skeleton.criticalStylesCaptured
      && !sameCriticalStyle(wrapper.criticalStyle, current.criticalStyle)
    ) {
      return invalid(
        "FORMAT_WRAPPER_STYLE_CHANGED",
        "An authored formatting wrapper changed a critical computed text style.",
        { nodeId: wrapper.nodeId },
      );
    }

    const exactRange = exactProjectedRange(wrapper, editRange, replacementText.length);
    if (exactRange) {
      if (
        current.textStart !== exactRange.startOffset
        || current.textEnd !== exactRange.endOffset
      ) {
        return invalid(
          "FORMAT_OUTSIDE_WRAPPER_COVERAGE_CHANGED",
          "A formatting wrapper outside the edit changed its text coverage.",
          {
            nodeId: wrapper.nodeId,
            expected: exactRange,
            actual: { startOffset: current.textStart, endOffset: current.textEnd },
          },
        );
      }
    } else if (!complete && wrapperIntersects(wrapper, editRange)) {
      const outsideFragments = projectedOutsideFragments(
        wrapper,
        editRange,
        replacementText.length,
      );
      const containsOutside = outsideFragments.every((fragment) => (
        current.textStart <= fragment.startOffset
        && current.textEnd >= fragment.endOffset
      ));
      if (!containsOutside) {
        return invalid(
          "FORMAT_PARTIAL_WRAPPER_COVERAGE_CHANGED",
          "A partially covered formatting wrapper no longer contains its untouched text.",
          {
            nodeId: wrapper.nodeId,
            outsideFragments,
            actual: { startOffset: current.textStart, endOffset: current.textEnd },
          },
        );
      }
    }
    if (!sourceCleanupEligible) preserveWrapperNodeIds.push(wrapper.nodeId);
  }

  const knownNodeIds = new Set([
    skeleton.rootNodeId,
    ...skeleton.wrappers.map(({ nodeId }) => nodeId),
    ...skeleton.hardBreaks.map(({ nodeId }) => nodeId),
  ]);
  const replacementStart = editRange.startOffset;
  const replacementEnd = replacementStart + replacementText.length;
  const temporaryWrappers = [];
  for (const record of analysis.elements) {
    if (record.isRoot || record.placeholderBreak) continue;
    if (record.sourceNodeId) {
      if (!knownNodeIds.has(record.sourceNodeId)) {
        return invalid(
          "FORMAT_UNKNOWN_SOURCE_WRAPPER",
          "The final DOM contains a source identity outside the captured format skeleton.",
          { nodeId: record.sourceNodeId, path: record.path },
        );
      }
      continue;
    }
    const insideReplacement = replacementEnd > replacementStart
      && record.textStart >= replacementStart
      && record.textEnd <= replacementEnd;
    if (
      !insideReplacement
      || !DISPOSABLE_FORMAT_TAGS.has(record.tagName)
      || record.attributes.length > 0
    ) {
      return invalid(
        "FORMAT_TEMPORARY_WRAPPER_UNSAFE",
        "A browser-created wrapper is outside the replacement or carries unsafe semantics.",
        {
          path: record.path,
          tagName: record.tagName,
          attributes: record.attributes,
          textStart: record.textStart,
          textEnd: record.textEnd,
          replacementStart,
          replacementEnd,
        },
      );
    }
    temporaryWrappers.push({
      path: record.path,
      tagName: record.tagName,
      textStart: record.textStart,
      textEnd: record.textEnd,
    });
    canonicalizeDom = true;
  }

  if (analysis.elements.some((record) => record.placeholderBreak)) {
    if (finalText !== "") {
      return invalid(
        "FORMAT_PLACEHOLDER_BREAK_UNSAFE",
        "A browser placeholder break is valid only for an empty final text host.",
      );
    }
    canonicalizeDom = true;
  }

  const inheritedLink = inheritanceStack.findLast((wrapper) => wrapper.link) ?? null;
  const patch = {
    version: FORMAT_SKELETON_VERSION,
    kind: "source-text-replacement",
    expectedSourceSha256: skeleton.sourceSha256,
    rootNodeId: skeleton.rootNodeId,
    editRange: {
      startOffset: editRange.startOffset,
      endOffset: editRange.endOffset,
      affinity,
    },
    beforeText: skeleton.text.slice(editRange.startOffset, editRange.endOffset),
    replacementText,
    deleteSegments: sourceEdit.deleteSegments.map((segment) => ({ ...segment })),
    insertAt: { ...sourceEdit.insertAt },
    inheritFormatFrom: {
      textOffset: editRange.startOffset,
      affinity,
      wrapperNodeIds: inheritanceStack.map(({ nodeId }) => nodeId),
      linkNodeId: inheritedLink?.nodeId ?? null,
    },
    preserveWrapperNodeIds,
    removalEligibleWrapperNodeIds,
    domMissingDisposableWrapperNodeIds,
    temporaryWrappers,
    protectedSourceRanges: skeleton.protectedSourceRanges.map((range) => ({ ...range })),
    canonicalizeDom,
  };

  return {
    ok: true,
    code: "FORMAT_SKELETON_VALID",
    reason: null,
    details: {
      finalTextLength: finalText.length,
      finalSelection: selection,
      canonicalizeDom,
    },
    patch,
  };
}

function normalizeTransactionReplacements(skeleton, replacements) {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    return invalid(
      "FORMAT_TRANSACTION_REPLACEMENTS_REQUIRED",
      "A format transaction requires at least one logical replacement.",
    );
  }
  const normalized = [];
  for (let inputIndex = 0; inputIndex < replacements.length; inputIndex += 1) {
    const replacement = replacements[inputIndex];
    const startOffset = Number(replacement?.startOffset);
    const endOffset = Number(replacement?.endOffset);
    try {
      assertTextRange(
        skeleton.text,
        startOffset,
        endOffset,
        "FORMAT_TRANSACTION",
      );
    } catch (error) {
      if (!(error instanceof FormatSkeletonError)) throw error;
      return invalid(error.code, error.message, {
        ...error.details,
        inputIndex,
      });
    }
    if (typeof replacement?.nextText !== "string") {
      return invalid(
        "FORMAT_TRANSACTION_NEXT_TEXT_REQUIRED",
        "Every transaction replacement requires an explicit nextText value.",
        { inputIndex },
      );
    }
    if (
      !isUtf16Boundary(replacement.nextText, 0)
      || !isUtf16Boundary(replacement.nextText, replacement.nextText.length)
    ) {
      return invalid(
        "FORMAT_TRANSACTION_NEXT_TEXT_UTF16_UNSAFE",
        "A transaction replacement has unsafe UTF-16 boundaries.",
        { inputIndex },
      );
    }
    const affinity = replacement.affinity === "left" ? "left" : "right";
    normalized.push({
      inputIndex,
      startOffset,
      endOffset,
      nextText: replacement.nextText,
      affinity,
    });
  }

  normalized.sort((left, right) => (
    left.startOffset - right.startOffset
    || left.endOffset - right.endOffset
    || left.inputIndex - right.inputIndex
  ));
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const overlaps = current.startOffset < previous.endOffset;
    const sharesCollapsedBoundary = current.startOffset === previous.endOffset
      && (
        current.startOffset === current.endOffset
        || previous.startOffset === previous.endOffset
      );
    if (overlaps || sharesCollapsedBoundary) {
      return invalid(
        sharesCollapsedBoundary
          ? "FORMAT_TRANSACTION_BOUNDARY_AMBIGUOUS"
          : "FORMAT_TRANSACTION_REPLACEMENTS_OVERLAP",
        sharesCollapsedBoundary
          ? "Two replacements cannot share a boundary with a collapsed insertion."
          : "Transaction replacements must not overlap in baseline logical coordinates.",
        {
          previous: {
            inputIndex: previous.inputIndex,
            startOffset: previous.startOffset,
            endOffset: previous.endOffset,
          },
          current: {
            inputIndex: current.inputIndex,
            startOffset: current.startOffset,
            endOffset: current.endOffset,
          },
        },
      );
    }
  }
  return { ok: true, replacements: normalized };
}

function finalTextForTransaction(baselineText, replacements) {
  const pieces = [];
  let cursor = 0;
  let cumulativeDelta = 0;
  const projected = replacements.map((replacement, replacementIndex) => {
    pieces.push(baselineText.slice(cursor, replacement.startOffset));
    pieces.push(replacement.nextText);
    const finalStartOffset = replacement.startOffset + cumulativeDelta;
    const finalEndOffset = finalStartOffset + replacement.nextText.length;
    cumulativeDelta += replacement.nextText.length
      - (replacement.endOffset - replacement.startOffset);
    cursor = replacement.endOffset;
    return {
      ...replacement,
      replacementIndex,
      finalStartOffset,
      finalEndOffset,
    };
  });
  pieces.push(baselineText.slice(cursor));
  return {
    text: pieces.join(""),
    replacements: projected,
  };
}

function replacementIntersectsWrapper(replacement, wrapper, wrapperNodeIds) {
  if (replacement.startOffset === replacement.endOffset) {
    return wrapperNodeIds.has(wrapper.nodeId);
  }
  return replacement.startOffset < wrapper.textEnd
    && replacement.endOffset > wrapper.textStart;
}

function untouchedWrapperFragments(wrapper, replacements) {
  const fragments = [];
  let cursor = wrapper.textStart;
  for (const replacement of replacements) {
    if (replacement.startOffset === replacement.endOffset) continue;
    if (replacement.endOffset <= wrapper.textStart) continue;
    if (replacement.startOffset >= wrapper.textEnd) break;
    const coveredStart = Math.max(wrapper.textStart, replacement.startOffset);
    const coveredEnd = Math.min(wrapper.textEnd, replacement.endOffset);
    if (coveredStart > cursor) {
      fragments.push({ startOffset: cursor, endOffset: coveredStart });
    }
    cursor = Math.max(cursor, coveredEnd);
  }
  if (cursor < wrapper.textEnd) {
    fragments.push({ startOffset: cursor, endOffset: wrapper.textEnd });
  }
  return fragments;
}

function projectOriginalOffset(replacements, offset) {
  let projected = offset;
  for (const replacement of replacements) {
    if (replacement.endOffset > offset) break;
    projected += replacement.nextText.length
      - (replacement.endOffset - replacement.startOffset);
  }
  return projected;
}

function projectUntouchedFragments(replacements, fragments) {
  return fragments.map((fragment) => ({
    startOffset: projectOriginalOffset(replacements, fragment.startOffset),
    endOffset: projectOriginalOffset(replacements, fragment.endOffset),
  }));
}

function exactTransactionWrapperRange(wrapper, replacements, touchByReplacement) {
  if (touchByReplacement.some(Boolean)) return null;
  let shift = 0;
  for (const replacement of replacements) {
    if (replacement.startOffset === replacement.endOffset) {
      if (replacement.startOffset <= wrapper.textStart) {
        shift += replacement.nextText.length;
      }
      continue;
    }
    if (replacement.endOffset <= wrapper.textStart) {
      shift += replacement.nextText.length
        - (replacement.endOffset - replacement.startOffset);
    }
  }
  return {
    startOffset: wrapper.textStart + shift,
    endOffset: wrapper.textEnd + shift,
  };
}

function canonicalTransactionWrapperRange(wrapper, replacements, descriptors) {
  let startOffset = wrapper.textStart;
  let textLength = wrapper.textEnd - wrapper.textStart;
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index];
    const descriptor = descriptors[index];
    const inherited = descriptor.inheritFormatFrom.wrapperNodeIds.includes(wrapper.nodeId);
    const deletedBeforeStart = replacement.startOffset;
    const deletedBeforeEnd = Math.min(replacement.endOffset, wrapper.textStart);
    if (
      deletedBeforeStart < wrapper.textStart
      && deletedBeforeEnd > deletedBeforeStart
    ) {
      startOffset -= deletedBeforeEnd - deletedBeforeStart;
    }
    if (!inherited && replacement.startOffset <= wrapper.textStart) {
      startOffset += replacement.nextText.length;
    }
    const overlapStart = Math.max(replacement.startOffset, wrapper.textStart);
    const overlapEnd = Math.min(replacement.endOffset, wrapper.textEnd);
    if (overlapEnd > overlapStart) textLength -= overlapEnd - overlapStart;
    if (inherited) textLength += replacement.nextText.length;
  }
  return {
    startOffset,
    endOffset: startOffset + Math.max(0, textLength),
  };
}

function transactionPatchFromSingle(singlePatch) {
  return {
    version: FORMAT_SKELETON_VERSION,
    kind: "source-text-transaction",
    expectedSourceSha256: singlePatch.expectedSourceSha256,
    rootNodeId: singlePatch.rootNodeId,
    replacements: [{
      replacementIndex: 0,
      inputIndex: 0,
      editRange: { ...singlePatch.editRange },
      finalRange: {
        startOffset: singlePatch.editRange.startOffset,
        endOffset: singlePatch.editRange.startOffset + singlePatch.replacementText.length,
      },
      beforeText: singlePatch.beforeText,
      nextText: singlePatch.replacementText,
      deleteSegments: singlePatch.deleteSegments.map((segment) => ({ ...segment })),
      insertAt: { ...singlePatch.insertAt },
      inheritFormatFrom: {
        ...singlePatch.inheritFormatFrom,
        wrapperNodeIds: [...singlePatch.inheritFormatFrom.wrapperNodeIds],
      },
    }],
    preserveWrapperNodeIds: [...singlePatch.preserveWrapperNodeIds],
    removalEligibleWrapperNodeIds: [...singlePatch.removalEligibleWrapperNodeIds],
    domMissingDisposableWrapperNodeIds: [
      ...singlePatch.domMissingDisposableWrapperNodeIds,
    ],
    temporaryWrappers: singlePatch.temporaryWrappers.map((wrapper) => ({
      ...wrapper,
      replacementIndex: 0,
    })),
    protectedSourceRanges: singlePatch.protectedSourceRanges.map((range) => ({ ...range })),
    canonicalizeDom: singlePatch.canonicalizeDom,
  };
}

/**
 * Validate several independent replacements against one baseline skeleton.
 * Every replacement remains in original logical coordinates and receives its
 * own SourceTextMap edit descriptor; disjoint edits are never widened or
 * merged through the unchanged source between them.
 */
export function validateFormatSkeletonTransaction(skeleton, options = {}) {
  if (
    !skeleton
    || skeleton.version !== FORMAT_SKELETON_VERSION
    || typeof skeleton.text !== "string"
    || !Array.isArray(skeleton.wrappers)
    || !Array.isArray(skeleton.hardBreaks)
    || !skeleton.sourceMap
  ) {
    fail("INVALID_FORMAT_SKELETON", "A captured FormatSkeleton is required.");
  }
  if (
    options.expectedSourceSha256
    && options.expectedSourceSha256 !== skeleton.sourceSha256
  ) {
    return invalid(
      "FORMAT_SOURCE_REVISION_STALE",
      "The source revision changed after this format skeleton was captured.",
      {
        expectedSourceSha256: options.expectedSourceSha256,
        skeletonSourceSha256: skeleton.sourceSha256,
      },
    );
  }

  const normalization = normalizeTransactionReplacements(
    skeleton,
    options.replacements,
  );
  if (!normalization.ok) return normalization;
  const expected = finalTextForTransaction(
    skeleton.text,
    normalization.replacements,
  );

  if (expected.replacements.length === 1) {
    const replacement = expected.replacements[0];
    const single = validateFormatSkeletonEdit(skeleton, {
      root: options.root,
      runtimeMap: options.runtimeMap,
      getComputedStyle: options.getComputedStyle,
      expectedSourceSha256: options.expectedSourceSha256,
      editRange: {
        startOffset: replacement.startOffset,
        endOffset: replacement.endOffset,
        affinity: replacement.affinity,
      },
      finalSelection: options.finalSelection,
      allowPlaceholderBreak: options.allowPlaceholderBreak,
    });
    if (!single.ok) return single;
    if (single.patch.replacementText !== replacement.nextText) {
      return invalid(
        "FORMAT_TRANSACTION_FINAL_TEXT_MISMATCH",
        "The final DOM text does not equal the explicit transaction replacement.",
        {
          expectedText: expected.text,
          actualReplacementText: single.patch.replacementText,
          expectedReplacementText: replacement.nextText,
        },
      );
    }
    const patch = transactionPatchFromSingle(single.patch);
    patch.replacements[0].inputIndex = replacement.inputIndex;
    patch.replacements[0].finalRange = {
      startOffset: replacement.finalStartOffset,
      endOffset: replacement.finalEndOffset,
    };
    return {
      ok: true,
      code: "FORMAT_SKELETON_TRANSACTION_VALID",
      reason: null,
      details: {
        finalTextLength: expected.text.length,
        finalSelection: single.details.finalSelection,
        replacementCount: 1,
        canonicalizeDom: patch.canonicalizeDom,
      },
      patch,
    };
  }

  const analysis = analyzeDom(options.root, {
    runtimeMap: options.runtimeMap,
    getComputedStyle: options.getComputedStyle,
    allowPlaceholderBreak: options.allowPlaceholderBreak,
  });
  if (!analysis.ok) return invalid(analysis.code, analysis.reason, analysis.details);
  if (analysis.text !== expected.text) {
    return invalid(
      "FORMAT_TRANSACTION_FINAL_TEXT_MISMATCH",
      "The final DOM text is not the exact result of the independent replacements.",
      {
        expectedText: expected.text,
        actualText: analysis.text,
      },
    );
  }

  const selection = validateFinalSelection(options.finalSelection, analysis.text);
  if (selection?.ok === false) return selection;

  const descriptors = [];
  for (const replacement of expected.replacements) {
    const linkViolation = linkBoundaryViolation(
      skeleton,
      replacement.startOffset,
      replacement.endOffset,
    );
    if (linkViolation) {
      return invalid(linkViolation.code, linkViolation.reason, {
        ...linkViolation.details,
        replacementIndex: replacement.replacementIndex,
        inputIndex: replacement.inputIndex,
      });
    }
    let sourceEdit;
    try {
      sourceEdit = textRangeToSourceEdit(
        skeleton.sourceMap,
        replacement.startOffset,
        replacement.endOffset,
        replacement.affinity,
      );
    } catch (error) {
      return invalid(
        "FORMAT_CROSS_BLOCK_EDIT",
        "A transaction replacement crosses source structure outside one text island.",
        {
          replacementIndex: replacement.replacementIndex,
          inputIndex: replacement.inputIndex,
          causeCode: error?.code ?? null,
          cause: String(error?.message ?? error),
        },
      );
    }
    const inheritanceStack = wrapperStackForSourceAnchor(
      skeleton,
      sourceEdit.insertAt,
    );
    const inheritedLink = inheritanceStack.findLast((wrapper) => wrapper.link) ?? null;
    descriptors.push({
      replacementIndex: replacement.replacementIndex,
      inputIndex: replacement.inputIndex,
      editRange: {
        startOffset: replacement.startOffset,
        endOffset: replacement.endOffset,
        affinity: replacement.affinity,
      },
      finalRange: {
        startOffset: replacement.finalStartOffset,
        endOffset: replacement.finalEndOffset,
      },
      beforeText: skeleton.text.slice(
        replacement.startOffset,
        replacement.endOffset,
      ),
      nextText: replacement.nextText,
      deleteSegments: sourceEdit.deleteSegments.map((segment) => ({ ...segment })),
      insertAt: { ...sourceEdit.insertAt },
      inheritFormatFrom: {
        textOffset: replacement.startOffset,
        affinity: replacement.affinity,
        wrapperNodeIds: inheritanceStack.map(({ nodeId }) => nodeId),
        linkNodeId: inheritedLink?.nodeId ?? null,
      },
    });
  }

  const observed = observedBySourceId(analysis);
  const finalRoot = analysis.elements[0];
  const rootMatches = observed.get(skeleton.rootNodeId) ?? [];
  if (
    finalRoot.tagName !== skeleton.root.tagName
    || (finalRoot.sourceNodeId && finalRoot.sourceNodeId !== skeleton.rootNodeId)
    || rootMatches.length > 1
  ) {
    return invalid(
      "FORMAT_ROOT_IDENTITY_CHANGED",
      "The authored text host changed during the format transaction.",
      {
        expectedNodeId: skeleton.rootNodeId,
        actualNodeId: finalRoot.sourceNodeId,
        expectedTagName: skeleton.root.tagName,
        actualTagName: finalRoot.tagName,
      },
    );
  }
  if (!sameAttributes(skeleton.root.domAttributes, finalRoot.attributes)) {
    return invalid(
      "FORMAT_ROOT_ATTRIBUTES_CHANGED",
      "The authored text host attributes changed during the format transaction.",
      { nodeId: skeleton.rootNodeId },
    );
  }
  if (
    skeleton.criticalStylesCaptured
    && !sameCriticalStyle(skeleton.root.criticalStyle, finalRoot.criticalStyle)
  ) {
    return invalid(
      "FORMAT_ROOT_STYLE_CHANGED",
      "The authored text host computed style changed during the format transaction.",
      { nodeId: skeleton.rootNodeId },
    );
  }

  const hardBreakViolation = validateHardBreaks(
    skeleton,
    observed,
    options.runtimeMap,
    (hardBreak) => ({
      startOffset: projectOriginalOffset(expected.replacements, hardBreak.textStart),
      endOffset: projectOriginalOffset(expected.replacements, hardBreak.textEnd),
    }),
  );
  if (hardBreakViolation) return hardBreakViolation;

  const inheritedWrapperIds = new Set(
    descriptors
      .filter((descriptor) => descriptor.nextText.length > 0)
      .flatMap((descriptor) => descriptor.inheritFormatFrom.wrapperNodeIds),
  );
  const wrapperState = skeleton.wrappers.map((wrapper) => {
    const touchByReplacement = expected.replacements.map((replacement, index) => (
      replacementIntersectsWrapper(
        replacement,
        wrapper,
        new Set(descriptors[index].inheritFormatFrom.wrapperNodeIds),
      )
    ));
    const untouchedFragments = untouchedWrapperFragments(
      wrapper,
      expected.replacements,
    );
    const fullyCovered = wrapper.textEnd > wrapper.textStart
      && untouchedFragments.length === 0;
    const sourceCleanupEligible = fullyCovered
      && wrapper.disposable
      && !inheritedWrapperIds.has(wrapper.nodeId);
    return {
      wrapper,
      touchByReplacement,
      untouchedFragments,
      fullyCovered,
      sourceCleanupEligible,
    };
  });
  const removalEligibleWrapperNodeIds = wrapperState
    .filter(({ sourceCleanupEligible }) => sourceCleanupEligible)
    .map(({ wrapper }) => wrapper.nodeId);
  const preserveWrapperNodeIds = [];
  const domMissingDisposableWrapperNodeIds = [];
  let canonicalizeDom = removalEligibleWrapperNodeIds.length > 0;

  for (const state of wrapperState) {
    const { wrapper } = state;
    const matches = observed.get(wrapper.nodeId) ?? [];
    if (matches.length > 1) {
      return invalid(
        "FORMAT_WRAPPER_IDENTITY_DUPLICATED",
        "An authored formatting wrapper was duplicated during the transaction.",
        { nodeId: wrapper.nodeId },
      );
    }
    if (matches.length === 0) {
      if (state.fullyCovered && wrapper.disposable) {
        domMissingDisposableWrapperNodeIds.push(wrapper.nodeId);
        if (!state.sourceCleanupEligible) preserveWrapperNodeIds.push(wrapper.nodeId);
        canonicalizeDom = true;
        continue;
      }
      return invalid(
        state.fullyCovered
          ? "FORMAT_PROTECTED_WRAPPER_REMOVED"
          : "FORMAT_PARTIAL_WRAPPER_REMOVED",
        "A wrapper not fully covered by the transaction was removed.",
        {
          nodeId: wrapper.nodeId,
          tagName: wrapper.tagName,
          fullyCovered: state.fullyCovered,
          disposable: wrapper.disposable,
        },
      );
    }

    const current = matches[0];
    if (current.tagName !== wrapper.tagName) {
      return invalid(
        "FORMAT_WRAPPER_TAG_CHANGED",
        "An authored formatting wrapper changed tag name during the transaction.",
        {
          nodeId: wrapper.nodeId,
          expectedTagName: wrapper.tagName,
          actualTagName: current.tagName,
        },
      );
    }
    if (!sameAttributes(wrapper.domAttributes, current.attributes)) {
      return invalid(
        "FORMAT_WRAPPER_ATTRIBUTES_CHANGED",
        "An authored formatting wrapper changed attributes during the transaction.",
        { nodeId: wrapper.nodeId },
      );
    }
    if (
      skeleton.criticalStylesCaptured
      && !sameCriticalStyle(wrapper.criticalStyle, current.criticalStyle)
    ) {
      return invalid(
        "FORMAT_WRAPPER_STYLE_CHANGED",
        "An authored formatting wrapper changed a critical computed style.",
        { nodeId: wrapper.nodeId },
      );
    }

    const exactRange = exactTransactionWrapperRange(
      wrapper,
      expected.replacements,
      state.touchByReplacement,
    );
    if (exactRange) {
      if (
        current.textStart !== exactRange.startOffset
        || current.textEnd !== exactRange.endOffset
      ) {
        return invalid(
          "FORMAT_OUTSIDE_WRAPPER_COVERAGE_CHANGED",
          "A wrapper outside all replacements changed its projected text coverage.",
          {
            nodeId: wrapper.nodeId,
            expected: exactRange,
            actual: { startOffset: current.textStart, endOffset: current.textEnd },
          },
        );
      }
    } else if (!state.fullyCovered) {
      const projectedFragments = projectUntouchedFragments(
        expected.replacements,
        state.untouchedFragments,
      );
      const containsOutside = projectedFragments.every((fragment) => (
        current.textStart <= fragment.startOffset
        && current.textEnd >= fragment.endOffset
      ));
      if (!containsOutside) {
        return invalid(
          "FORMAT_PARTIAL_WRAPPER_COVERAGE_CHANGED",
          "A wrapper no longer contains every untouched projected text fragment.",
          {
            nodeId: wrapper.nodeId,
            projectedFragments,
            actual: { startOffset: current.textStart, endOffset: current.textEnd },
          },
        );
      }
    }
    if (!state.sourceCleanupEligible) {
      const canonicalRange = canonicalTransactionWrapperRange(
        wrapper,
        expected.replacements,
        descriptors,
      );
      if (
        current.textStart !== canonicalRange.startOffset
        || current.textEnd !== canonicalRange.endOffset
      ) {
        canonicalizeDom = true;
      }
    }
    if (!state.sourceCleanupEligible) preserveWrapperNodeIds.push(wrapper.nodeId);
  }

  const knownNodeIds = new Set([
    skeleton.rootNodeId,
    ...skeleton.wrappers.map(({ nodeId }) => nodeId),
    ...skeleton.hardBreaks.map(({ nodeId }) => nodeId),
  ]);
  const temporaryWrappers = [];
  for (const record of analysis.elements) {
    if (record.isRoot || record.placeholderBreak) continue;
    if (record.sourceNodeId) {
      if (!knownNodeIds.has(record.sourceNodeId)) {
        return invalid(
          "FORMAT_UNKNOWN_SOURCE_WRAPPER",
          "The final DOM contains a source identity outside the captured skeleton.",
          { nodeId: record.sourceNodeId, path: record.path },
        );
      }
      continue;
    }
    const containingReplacement = expected.replacements.find((replacement) => (
      replacement.finalEndOffset > replacement.finalStartOffset
      && record.textStart >= replacement.finalStartOffset
      && record.textEnd <= replacement.finalEndOffset
    ));
    if (
      !containingReplacement
      || !DISPOSABLE_FORMAT_TAGS.has(record.tagName)
      || record.attributes.length > 0
    ) {
      return invalid(
        "FORMAT_TEMPORARY_WRAPPER_UNSAFE",
        "A browser-created wrapper is outside every projected replacement or is unsafe.",
        {
          path: record.path,
          tagName: record.tagName,
          attributes: record.attributes,
          textStart: record.textStart,
          textEnd: record.textEnd,
          replacementRanges: expected.replacements.map((replacement) => ({
            replacementIndex: replacement.replacementIndex,
            startOffset: replacement.finalStartOffset,
            endOffset: replacement.finalEndOffset,
          })),
        },
      );
    }
    temporaryWrappers.push({
      path: record.path,
      tagName: record.tagName,
      textStart: record.textStart,
      textEnd: record.textEnd,
      replacementIndex: containingReplacement.replacementIndex,
    });
    canonicalizeDom = true;
  }

  if (analysis.elements.some((record) => record.placeholderBreak)) {
    if (analysis.text !== "") {
      return invalid(
        "FORMAT_PLACEHOLDER_BREAK_UNSAFE",
        "A browser placeholder break is valid only for an empty final text host.",
      );
    }
    canonicalizeDom = true;
  }

  const patch = {
    version: FORMAT_SKELETON_VERSION,
    kind: "source-text-transaction",
    expectedSourceSha256: skeleton.sourceSha256,
    rootNodeId: skeleton.rootNodeId,
    replacements: descriptors,
    preserveWrapperNodeIds,
    removalEligibleWrapperNodeIds,
    domMissingDisposableWrapperNodeIds,
    temporaryWrappers,
    protectedSourceRanges: skeleton.protectedSourceRanges.map((range) => ({ ...range })),
    canonicalizeDom,
  };

  return {
    ok: true,
    code: "FORMAT_SKELETON_TRANSACTION_VALID",
    reason: null,
    details: {
      finalTextLength: analysis.text.length,
      finalSelection: selection,
      replacementCount: descriptors.length,
      canonicalizeDom,
    },
    patch,
  };
}

export function isDisposableFormatSkeletonWrapper(value) {
  if (typeof value === "string") return DISPOSABLE_FORMAT_TAGS.has(value.toLowerCase());
  return disposableSourceWrapper(value);
}
