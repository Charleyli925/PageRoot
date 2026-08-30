import { decodeHTML } from "entities";

import {
  parseHtmlSource,
  rawStartTagAttributes,
} from "../html-source-parser.mjs";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
} from "../../shared/pageroot-element-identity.mjs";
import {
  HTML_VOID_TAGS,
  materializeEditableIslandHtml,
  planSemanticPlainTextPatch,
} from "../../shared/editable-island.mjs";
import {
  canonicalSourceStyleDeclaration,
} from "../../shared/source-style-value.mjs";
import {
  isNativeDirectEditRoot,
} from "../../shared/native-edit-capability.mjs";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SOURCE_TEXT_HARD_BREAK = "\n";
const SOURCE_TEXT_OBJECT = "\ufffc";
const TEXT_RANGE_LAYOUT_GUARD = "all: unset; display: inline !important";
const TRANSPARENT_TEXT_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn",
  "em", "i", "ins", "kbd", "label", "mark", "q", "s", "samp", "small",
  "span", "strong", "sub", "sup", "time", "u", "var",
]);
const HTML_ATTRIBUTE_NAME_PATTERN = /^[^\u0000-\u0020"'/>=]+$/u;
const CSS_PROPERTY_NAME_PATTERN = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/u;

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

function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replaceAll('"', "&quot;");
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
        node,
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

function expectedRangeStylePatches(html, rootNode, operation, createdIds) {
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

function coalescedRangeStyleTarget(html, rootNode, operation, beforeIdentity) {
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
  ) return null;
  const selected = runs.filter((run) => (
    run.kind === "text"
    && Math.min(endOffset, run.textEnd) > Math.max(startOffset, run.textStart)
  ));
  if (selected.length !== 1) return null;
  const [run] = selected;
  const segmentStart = Math.max(startOffset, run.textStart) - run.textStart;
  const segmentEnd = Math.min(endOffset, run.textEnd) - run.textStart;
  if (segmentStart !== 0 || segmentEnd !== run.value.length) return null;
  const rootChildren = childNodesFor(rootNode);
  let styleNode = rootChildren.length === 1 && rootChildren[0] === run.node
    ? rootNode
    : null;
  const immediateParent = run.node?.parentNode;
  if (
    !styleNode
    && immediateParent !== rootNode
    && typeof immediateParent?.tagName === "string"
  ) {
    const parentChildren = childNodesFor(immediateParent);
    if (parentChildren.length === 1 && parentChildren[0] === run.node) {
      styleNode = immediateParent;
    }
  }
  const start = styleNode?.sourceCodeLocation?.startTag?.startOffset;
  const target = Number.isInteger(start)
    ? beforeIdentity.elements.find((element) => element.startOffset === start)
    : null;
  return styleNode && target ? { rootNode: styleNode, target } : null;
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

function exactForwardTarget(forward, forwardBeforeIdentity, operation) {
  const target = identityElementMap(forwardBeforeIdentity).get(operation.target.elementId);
  const rootNode = target ? parsedElementAt(forward.beforeHtml, target.startOffset) : null;
  if (!target || !rootNode) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The semantic operation target is missing from its exact forward source.",
    );
  }
  return { target, rootNode };
}

function assertTextRangeTargetCapability(target, rootNode) {
  if (
    rootNode.namespaceURI !== HTML_NAMESPACE
    || target.boundarySafe !== true
    || !isNativeDirectEditRoot(target.tagName)
  ) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The semantic text range target is not editable by the shared source capability.",
    );
  }
}

function expectedReplaceTextRangePatches(html, target, rootNode, operation) {
  assertTextRangeTargetCapability(target, rootNode);
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
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The replaceTextRange evidence does not match the exact source quote.",
    );
  }
  if (runs.some((run) => (
    run.kind !== "text"
    && startOffset < run.textEnd
    && endOffset > run.textStart
  ))) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The replaceTextRange evidence crosses an authored structure boundary.",
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
  if (segments.length === 0) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The replaceTextRange evidence does not contain source-backed text.",
    );
  }
  return segments.map((segment, index) => ({
    startOffset: segment.startOffset,
    endOffset: segment.endOffset,
    before: html.slice(segment.startOffset, segment.endOffset),
    after: index === 0 ? escapeHtmlText(operation.text) : "",
    kind: "semantic:replace-text-range",
  }));
}

function expectedSetAttributePatches(html, target, rootNode, operation) {
  const attributeName = String(operation.name ?? "").toLowerCase();
  if (
    !HTML_ATTRIBUTE_NAME_PATTERN.test(attributeName)
    || attributeName === PAGEROOT_ELEMENT_ID_ATTRIBUTE
  ) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The setAttribute evidence does not name an editable source attribute.",
    );
  }
  const startTag = rootNode.sourceCodeLocation?.startTag;
  const matches = rawStartTagAttributes(html, startTag)
    .filter((attribute) => attribute.name === attributeName);
  if (matches.length > 1) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The setAttribute target contains a repeated authored attribute.",
    );
  }
  const existing = matches[0] ?? null;
  if (operation.value === null) {
    return existing ? [{
      startOffset: existing.range.startOffset,
      endOffset: existing.range.endOffset,
      before: existing.raw,
      after: "",
      kind: "semantic:set-attribute",
    }] : [];
  }
  const nextAttribute = `${existing?.rawName ?? attributeName}="${
    escapeHtmlAttribute(operation.value)
  }"`;
  return existing ? [{
    startOffset: existing.range.startOffset,
    endOffset: existing.range.endOffset,
    before: existing.raw,
    after: nextAttribute,
    kind: "semantic:set-attribute",
  }] : [{
    startOffset: target.closingDelimiterOffset,
    endOffset: target.closingDelimiterOffset,
    before: "",
    after: ` ${nextAttribute}`,
    kind: "semantic:set-attribute",
  }];
}

function topLevelColon(raw) {
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    const next = raw[index + 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && depth > 0) depth -= 1;
    else if (character === ":" && depth === 0) return index;
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
    const character = raw[index];
    const next = raw[index + 1];
    if (index === raw.length || (character === ";" && !quote && !comment && depth === 0)) {
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
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && depth > 0) depth -= 1;
  }
  return segments;
}

function trimBounds(raw, startOffset, endOffset) {
  while (startOffset < endOffset && /\s/u.test(raw[startOffset])) startOffset += 1;
  while (endOffset > startOffset && /\s/u.test(raw[endOffset - 1])) endOffset -= 1;
  return { startOffset, endOffset };
}

function parseInlineStyle(rawStyle) {
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
    const importantMatch = trimmedValue.match(/(\s*!\s*important)\s*$/iu);
    const importantStart = importantMatch
      ? valueBounds.endOffset - importantMatch[0].length
      : valueBounds.endOffset;
    declarations.push({
      normalizedProperty,
      importantRaw: importantMatch ? segment.raw.slice(importantStart, valueBounds.endOffset) : "",
      segmentStartOffset: segment.startOffset,
      separatorEndOffset: segment.separatorEndOffset,
      valueStartOffset: segment.startOffset + valueBounds.startOffset,
      valueEndOffset: segment.startOffset + valueBounds.endOffset,
    });
  }
  return declarations;
}

function assertCanonicalInlineStyle(rawStyle) {
  if (/\/\*|\*\//u.test(rawStyle)) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The existing inline style contains unsafe comment syntax.",
    );
  }
  for (const segment of declarationSegments(rawStyle)) {
    if (segment.raw.trim() === "") continue;
    const colon = topLevelColon(segment.raw);
    const bounds = colon < 0 ? null : trimBounds(segment.raw, 0, colon);
    const property = bounds
      ? segment.raw.slice(bounds.startOffset, bounds.endOffset)
      : "";
    if (!CSS_PROPERTY_NAME_PATTERN.test(property)) {
      fail(
        "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
        "The existing inline style is not canonical source CSS.",
      );
    }
  }
}

function styleDeclaration(operation, quote, compact = false) {
  try {
    return canonicalSourceStyleDeclaration({
      property: operation.property,
      value: operation.value,
      important: operation.important,
      quote,
      compact,
    });
  } catch (cause) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The setStyle evidence violates the shared source-style contract.",
      { sourceStyleError: cause?.code || "SOURCE_STYLE_INVALID" },
    );
  }
}

function preferredQuote(attributes) {
  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    if (attributes[index].quote === '"' || attributes[index].quote === "'") {
      return attributes[index].quote;
    }
  }
  return '"';
}

function expectedSetStylePatches(html, target, rootNode, operation) {
  const startTag = rootNode.sourceCodeLocation?.startTag;
  const attributes = rawStartTagAttributes(html, startTag);
  const styleAttributes = attributes.filter((attribute) => attribute.name === "style");
  if (styleAttributes.length > 1) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The setStyle target contains duplicate style attributes.",
    );
  }
  const quote = preferredQuote(attributes);
  const canonical = styleDeclaration(operation, quote);
  if (styleAttributes.length === 0) {
    return [{
      startOffset: target.closingDelimiterOffset,
      endOffset: target.closingDelimiterOffset,
      before: "",
      after: ` style=${quote}${canonical.declaration}${quote}`,
      kind: "style-attribute-add",
    }];
  }
  const styleAttribute = styleAttributes[0];
  if (!styleAttribute.valueRange) {
    return [{
      startOffset: styleAttribute.range.startOffset,
      endOffset: styleAttribute.range.endOffset,
      before: styleAttribute.raw,
      after: `${styleAttribute.rawName}=${quote}${canonical.declaration}${quote}`,
      kind: "style-attribute",
    }];
  }
  const rawStyle = html.slice(
    styleAttribute.valueRange.startOffset,
    styleAttribute.valueRange.endOffset,
  );
  assertCanonicalInlineStyle(rawStyle);
  const declarations = parseInlineStyle(rawStyle);
  const matching = declarations.filter(
    (declaration) => declaration.normalizedProperty === canonical.property,
  );
  if (matching.length > 1) {
    fail(
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The setStyle target contains duplicate declarations for its property.",
    );
  }
  if (matching.length === 1) {
    const compact = styleAttribute.quote === null;
    const encoded = styleDeclaration(operation, styleAttribute.quote, compact).declaration;
    const separator = compact ? ":" : ": ";
    const nextValue = encoded.slice(encoded.indexOf(separator) + separator.length);
    const declaration = matching[0];
    return [{
      startOffset: styleAttribute.valueRange.startOffset + declaration.valueStartOffset,
      endOffset: styleAttribute.valueRange.startOffset + declaration.valueEndOffset,
      before: rawStyle.slice(declaration.valueStartOffset, declaration.valueEndOffset),
      after: nextValue,
      kind: "style-declaration-update",
    }];
  }
  let insertionOffset = rawStyle.length;
  while (insertionOffset > 0 && /\s/u.test(rawStyle[insertionOffset - 1])) insertionOffset -= 1;
  const compact = styleAttribute.quote === null;
  const declaration = styleDeclaration(operation, styleAttribute.quote, compact).declaration;
  const meaningful = rawStyle.slice(0, insertionOffset).trim();
  const prefix = meaningful === ""
    ? ""
    : meaningful.endsWith(";")
      ? (compact ? "" : " ")
      : (compact ? ";" : "; ");
  return [{
    startOffset: styleAttribute.valueRange.startOffset + insertionOffset,
    endOffset: styleAttribute.valueRange.startOffset + insertionOffset,
    before: "",
    after: `${prefix}${declaration}`,
    kind: "style-declaration-add",
  }];
}

function assertIdentityPreservingOperationMaterialization(
  step,
  operation,
  direction,
  beforeIdentity,
  afterIdentity,
) {
  if (![
    "replaceTextRange",
    "setAttribute",
    "setStyle",
  ].includes(operation.type) || (operation.type === "setStyle" && operation.range)) return;
  const forward = forwardEvidence(step, direction);
  const forwardBeforeIdentity = direction === "undo" ? afterIdentity : beforeIdentity;
  const { target, rootNode } = exactForwardTarget(
    forward,
    forwardBeforeIdentity,
    operation,
  );
  const expected = operation.type === "replaceTextRange"
    ? expectedReplaceTextRangePatches(forward.beforeHtml, target, rootNode, operation)
    : operation.type === "setAttribute"
      ? expectedSetAttributePatches(forward.beforeHtml, target, rootNode, operation)
      : expectedSetStylePatches(forward.beforeHtml, target, rootNode, operation);
  assertExactPatches(
    forward.patches,
    expected,
    "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
    `The saved source is not the exact semantic ${operation.type} materialization.`,
  );
}

function assertSetTextMaterialization(step, operation, direction, beforeIdentity, afterIdentity) {
  if (operation.type !== "setText") return;
  const forward = forwardEvidence(step, direction);
  const forwardBeforeIdentity = direction === "undo" ? afterIdentity : beforeIdentity;
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
  let materializedContent;
  try {
    materializedContent = materializeEditableIslandHtml(operation.contentHtml, {
      baselineInnerHtml: forward.beforeHtml.slice(contentStart, contentEnd),
      replayPagerootIds: operation.createdPagerootIds ?? [],
    });
  } catch (cause) {
    fail(
      "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH",
      "The setText content violates the shared editable-island contract.",
      { editableIslandError: cause?.code || "EDITABLE_ISLAND_INVALID" },
    );
  }
  if (
    materializedContent.html !== operation.contentHtml
    || materializedContent.createdPagerootIds.length
      !== (operation.createdPagerootIds ?? []).length
    || materializedContent.createdPagerootIds.some(
      (elementId, index) => elementId !== operation.createdPagerootIds[index],
    )
  ) {
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
}

function assertRangeStyleMaterialization(step, operation, direction, beforeIdentity, afterIdentity) {
  if (
    operation.type !== "setStyle"
    || !operation.range
  ) return;
  const forward = forwardEvidence(step, direction);
  const forwardBeforeIdentity = direction === "undo" ? afterIdentity : beforeIdentity;
  const forwardAfterIdentity = direction === "undo" ? beforeIdentity : afterIdentity;
  const target = identityElementMap(forwardBeforeIdentity).get(operation.target.elementId);
  const rootNode = target ? parsedElementAt(forward.beforeHtml, target.startOffset) : null;
  if (!rootNode) {
    fail(
      "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH",
      "The range-style target is missing from its exact forward source.",
    );
  }
  assertTextRangeTargetCapability(target, rootNode);
  const coalescedTarget = coalescedRangeStyleTarget(
    forward.beforeHtml,
    rootNode,
    operation,
    forwardBeforeIdentity,
  );
  if (coalescedTarget) {
    assertExactPatches(
      forward.patches,
      expectedSetStylePatches(
        forward.beforeHtml,
        coalescedTarget.target,
        coalescedTarget.rootNode,
        operation,
      ),
      "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH",
      "The coalesced range style is not the exact semantic inline-style materialization.",
    );
    return;
  }
  const createdIds = Array.isArray(operation.createdPagerootIds)
    && operation.createdPagerootIds.length > 0
    ? operation.createdPagerootIds
    : forwardAfterIdentity.elements
      .filter((element) => !forwardBeforeIdentity.claimedIds.has(element.pagerootId))
      .map((element) => element.pagerootId);
  assertExactPatches(
    forward.patches,
    expectedRangeStylePatches(forward.beforeHtml, rootNode, operation, createdIds),
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
  assertIdentityPreservingOperationMaterialization(
    step,
    operation,
    direction,
    beforeIdentity,
    afterIdentity,
  );
}
