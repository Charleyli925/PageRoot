import { decodeHTML } from "entities";

import { parseHtmlSource } from "../html-source-parser.mjs";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
} from "../../shared/pageroot-element-identity.mjs";
import {
  HTML_VOID_TAGS,
  normalizeEditableIslandHtml,
  planSemanticPlainTextPatch,
} from "../../shared/editable-island.mjs";
import {
  canonicalSourceStyleDeclaration,
} from "../../shared/source-style-value.mjs";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SOURCE_TEXT_HARD_BREAK = "\n";
const SOURCE_TEXT_OBJECT = "\ufffc";
const TEXT_RANGE_LAYOUT_GUARD = "all: unset; display: inline !important";
const TRANSPARENT_TEXT_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn",
  "em", "i", "ins", "kbd", "label", "mark", "q", "s", "samp", "small",
  "span", "strong", "sub", "sup", "time", "u", "var",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SemanticIdentityAuthorizationError";
  error.code = code;
  error.details = details;
  throw error;
}

function childNodesFor(node) {
  if (node?.nodeName === "template" && node.content) {
    return node.content.childNodes ?? [];
  }
  return node?.childNodes ?? [];
}

function forwardEvidence(step, direction) {
  return direction === "undo"
    ? {
        beforeHtml: step.afterHtml,
        afterHtml: step.beforeHtml,
        patches: step.operation.reversePatches,
      }
    : {
        beforeHtml: step.beforeHtml,
        afterHtml: step.afterHtml,
        patches: step.operation.forwardPatches,
      };
}

function identityElementMap(inspection) {
  return new Map(inspection.elements.map((element) => [element.pagerootId, element]));
}

function parsedElementAt(html, startOffset) {
  return parseHtmlSource(html).elements.find((token) => token.start === startOffset)?.node ?? null;
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
    if (/\s|<|&/u.test(character)) break;
  }
  if (semicolonOffset >= 0) {
    const source = raw.slice(startOffset, semicolonOffset + 1);
    const decoded = decodeHTML(source);
    if (decoded !== source) return { rawLength: source.length, decoded };
  }
  for (let cursor = startOffset + 2; cursor <= tokenLimit; cursor += 1) {
    const source = raw.slice(startOffset, cursor);
    const decoded = decodeHTML(source);
    if (decoded !== source) return { rawLength: source.length, decoded };
    const next = raw[cursor];
    if (!next || /\s|<|&|;/u.test(next)) break;
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
  if (decodedValue !== expectedValue) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_SOURCE_UNSAFE",
      "The styled text cannot be mapped to its exact authored encoding.",
    );
  }
  return boundaries;
}

function sourceTextProjection(html, rootNode) {
  const runs = [];
  let text = "";
  const pushBoundary = (kind) => {
    const value = kind === "hard-break" ? SOURCE_TEXT_HARD_BREAK : SOURCE_TEXT_OBJECT;
    runs.push({ kind, textStart: text.length, textEnd: text.length + value.length });
    text += value;
  };
  const visit = (node) => {
    if (node?.nodeName === "#text") {
      const location = node.sourceCodeLocation;
      if (!Number.isInteger(location?.startOffset) || !Number.isInteger(location?.endOffset)) {
        fail(
          "SEMANTIC_IDENTITY_RANGE_STYLE_SOURCE_UNSAFE",
          "The styled text does not have exact authored source boundaries.",
        );
      }
      const value = String(node.value ?? "");
      if (value.length === 0) return;
      runs.push({
        kind: "text",
        value,
        raw: html.slice(location.startOffset, location.endOffset),
        sourceStart: location.startOffset,
        textStart: text.length,
        textEnd: text.length + value.length,
      });
      text += value;
      return;
    }
    if (node?.nodeName === "#comment") {
      pushBoundary("structure");
      return;
    }
    if (typeof node?.tagName !== "string") return;
    const tagName = node.tagName.toLowerCase();
    if (tagName === "wbr") return;
    if (tagName === "br") {
      pushBoundary("hard-break");
      return;
    }
    if (
      node.namespaceURI !== HTML_NAMESPACE
      || !TRANSPARENT_TEXT_ELEMENTS.has(tagName)
    ) {
      pushBoundary("structure");
      return;
    }
    for (const child of childNodesFor(node)) visit(child);
  };
  for (const child of childNodesFor(rootNode)) visit(child);
  return { text, runs };
}

function rawBoundary(run, decodedOffset) {
  const rawOffset = decodedBoundaryMap(run.raw, run.value).get(decodedOffset);
  if (rawOffset === undefined) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_SOURCE_UNSAFE",
      "The styled range begins or ends inside an encoded source character.",
    );
  }
  return run.sourceStart + rawOffset;
}

function expectedRangeStylePatches(html, rootNode, operation) {
  const { text, runs } = sourceTextProjection(html, rootNode);
  const startOffset = Number(operation.range?.startOffset);
  const endOffset = Number(operation.range?.endOffset);
  if (
    !Number.isSafeInteger(startOffset)
    || !Number.isSafeInteger(endOffset)
    || startOffset < 0
    || endOffset <= startOffset
    || endOffset > text.length
    || text.slice(startOffset, endOffset) !== operation.range?.quote
  ) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
      "The range-style evidence does not match the exact source quote.",
    );
  }
  if (runs.some((run) => (
    run.kind !== "text"
    && startOffset < run.textEnd
    && endOffset > run.textStart
  ))) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
      "The range-style evidence crosses an authored structure boundary.",
    );
  }
  const segments = runs.filter((run) => (
    run.kind === "text"
    && Math.min(endOffset, run.textEnd) > Math.max(startOffset, run.textStart)
  )).map((run) => {
    const segmentStart = Math.max(startOffset, run.textStart) - run.textStart;
    const segmentEnd = Math.min(endOffset, run.textEnd) - run.textStart;
    return {
      startOffset: rawBoundary(run, segmentStart),
      endOffset: rawBoundary(run, segmentEnd),
    };
  });
  const createdIds = operation.createdPagerootIds ?? [];
  if (segments.length === 0 || segments.length !== createdIds.length) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
      "The range-style wrapper count does not match its exact source segments.",
    );
  }
  let materializedStyle;
  try {
    materializedStyle = canonicalSourceStyleDeclaration({
      property: operation.property,
      value: operation.value,
      important: operation.important,
      quote: '"',
    });
  } catch (cause) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
      "The range-style value violates the shared source-style contract.",
      { sourceStyleError: cause?.code || "SOURCE_STYLE_INVALID" },
    );
  }
  const declaration = materializedStyle.declaration;
  return segments.flatMap((segment, index) => [
    {
      startOffset: segment.startOffset,
      endOffset: segment.startOffset,
      before: "",
      after: `<span style="${TEXT_RANGE_LAYOUT_GUARD}; ${declaration}" ${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${createdIds[index]}">`,
      kind: "text-range-style-open",
    },
    {
      startOffset: segment.endOffset,
      endOffset: segment.endOffset,
      before: "",
      after: "</span>",
      kind: "text-range-style-close",
    },
  ]).sort((left, right) => left.startOffset - right.startOffset);
}

function assertExactPatches(actual, expected, code, message) {
  const members = ["startOffset", "endOffset", "before", "after", "kind"];
  if (
    actual.length !== expected.length
    || expected.some((patch, index) => members.some(
      (member) => actual[index]?.[member] !== patch[member],
    ))
  ) {
    fail(code, message, { expectedPatchCount: expected.length, actualPatchCount: actual.length });
  }
}

function assertSetTextMaterialization(step, operation, direction, beforeIdentity, afterIdentity) {
  if (operation.type !== "setText") return;
  const forward = forwardEvidence(step, direction);
  const forwardBeforeIdentity = direction === "undo" ? afterIdentity : beforeIdentity;
  const forwardAfterIdentity = direction === "undo" ? beforeIdentity : afterIdentity;
  const target = identityElementMap(forwardBeforeIdentity).get(operation.target.elementId);
  const rootNode = target ? parsedElementAt(forward.beforeHtml, target.startOffset) : null;
  const location = rootNode?.sourceCodeLocation;
  const contentStart = location?.startTag?.endOffset;
  const contentEnd = location?.endTag?.startOffset ?? location?.endOffset;
  if (!Number.isInteger(contentStart) || !Number.isInteger(contentEnd)) {
    fail(
      "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
      "The setText target does not have exact source content boundaries.",
    );
  }
  if (operation.contentHtml === undefined) {
    assertExactPatches(forward.patches, [planSemanticPlainTextPatch(forward.beforeHtml, {
      tagName: rootNode.tagName,
      isVoid: HTML_VOID_TAGS.has(String(rootNode.tagName ?? "").toLowerCase()),
      contentStartOffset: contentStart,
      contentEndOffset: contentEnd,
      text: operation.text,
    })],
    "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
    "The saved source is not the exact semantic plain-text materialization.");
    return;
  }
  let normalizedContentHtml;
  try {
    normalizedContentHtml = normalizeEditableIslandHtml(operation.contentHtml, {
      baselineInnerHtml: forward.beforeHtml.slice(contentStart, contentEnd),
    });
  } catch (cause) {
    fail(
      "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
      "The setText content violates the shared editable-island contract.",
      { editableIslandError: cause?.code || "EDITABLE_ISLAND_INVALID" },
    );
  }
  if (normalizedContentHtml !== operation.contentHtml) {
    fail(
      "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
      "The setText content is not the canonical shared editable-island materialization.",
    );
  }
  assertExactPatches(forward.patches, [{
    startOffset: contentStart,
    endOffset: contentEnd,
    before: forward.beforeHtml.slice(contentStart, contentEnd),
    after: operation.contentHtml,
    kind: "editable-island",
  }],
  "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
  "The saved editable island is not the exact semantic setText materialization.");
  const createdIds = operation.createdPagerootIds ?? [];
  const forwardAfterById = identityElementMap(forwardAfterIdentity);
  const afterTarget = forwardAfterById.get(operation.target.elementId);
  for (const elementId of createdIds) {
    const element = forwardAfterById.get(elementId);
    const injected = ` ${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${elementId}"`;
    const attributeStart = element?.closingDelimiterOffset - injected.length;
    if (
      element?.tagName !== "br"
      || !afterTarget
      || element.startOffset < afterTarget.startOffset
      || element.sourceEndOffset > afterTarget.sourceEndOffset
      || attributeStart < element.startOffset
      || forward.afterHtml.slice(attributeStart, element.closingDelimiterOffset) !== injected
    ) {
      fail(
        "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
        "setText can allocate persistent identity only for a kernel-form line break inside its target.",
        { elementId },
      );
    }
  }
}

function assertRangeStyleMaterialization(step, operation, direction, beforeIdentity, afterIdentity) {
  if (
    operation.type !== "setStyle"
    || !operation.range
    || !Array.isArray(operation.createdPagerootIds)
    || operation.createdPagerootIds.length === 0
  ) return;
  const forward = forwardEvidence(step, direction);
  const forwardBeforeIdentity = direction === "undo" ? afterIdentity : beforeIdentity;
  const target = identityElementMap(forwardBeforeIdentity).get(operation.target.elementId);
  const rootNode = target ? parsedElementAt(forward.beforeHtml, target.startOffset) : null;
  if (!rootNode) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
      "The range-style target is missing from its exact forward source.",
    );
  }
  assertExactPatches(
    forward.patches,
    expectedRangeStylePatches(forward.beforeHtml, rootNode, operation),
    "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
    "The saved range wrappers do not match the exact semantic range and style.",
  );
}

export function assertKernelTextMaterialization({
  step,
  beforeIdentity,
  afterIdentity,
  operation,
  direction,
}) {
  assertSetTextMaterialization(
    step,
    operation,
    direction,
    beforeIdentity,
    afterIdentity,
  );
  assertRangeStyleMaterialization(
    step,
    operation,
    direction,
    beforeIdentity,
    afterIdentity,
  );
}
