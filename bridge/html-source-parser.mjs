import { decodeHTMLAttribute } from "entities";
import { parse, serialize } from "parse5";

function sourceSlice(source, location) {
  if (
    !Number.isInteger(location?.startOffset)
    || !Number.isInteger(location?.endOffset)
  ) {
    return "";
  }
  return source.slice(location.startOffset, location.endOffset);
}

/**
 * Parse the raw authored start-tag attribute sequence, including duplicate
 * names, rather than parse5's normalized attribute map. Bridge identity checks
 * and scope evidence both need the bytes as written.
 */
export function rawStartTagAttributes(source, location) {
  const raw = sourceSlice(source, location);
  if (!raw.startsWith("<")) return [];
  const sourceOffset = location.startOffset;
  const attributes = [];
  let cursor = 1;
  while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
  while (
    cursor < raw.length
    && !/[\s/>]/u.test(raw[cursor])
  ) {
    cursor += 1;
  }
  while (cursor < raw.length) {
    while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
    if (
      cursor >= raw.length
      || raw[cursor] === ">"
      || (raw[cursor] === "/" && raw[cursor + 1] === ">")
    ) {
      break;
    }
    const nameStart = cursor;
    while (
      cursor < raw.length
      && !/[\s=/>]/u.test(raw[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const nameEnd = cursor;
    const rawName = raw.slice(nameStart, nameEnd);
    const name = rawName.toLowerCase();
    while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
    let rawValue = "";
    let equalsOffset = null;
    let quote = null;
    let valueStart = null;
    let valueEnd = null;
    if (raw[cursor] === "=") {
      equalsOffset = cursor;
      cursor += 1;
      while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
      quote = raw[cursor] === '"' || raw[cursor] === "'"
        ? raw[cursor]
        : null;
      if (quote) {
        cursor += 1;
        valueStart = cursor;
        while (cursor < raw.length && raw[cursor] !== quote) cursor += 1;
        valueEnd = cursor;
        rawValue = raw.slice(valueStart, cursor);
        if (raw[cursor] === quote) cursor += 1;
      } else {
        valueStart = cursor;
        while (
          cursor < raw.length
          && !/[\s>]/u.test(raw[cursor])
          && !(raw[cursor] === "/" && raw[cursor + 1] === ">")
        ) {
          cursor += 1;
        }
        valueEnd = cursor;
        rawValue = raw.slice(valueStart, cursor);
      }
    }
    const attributeEnd = cursor;
    attributes.push({
      name,
      rawName,
      raw: raw.slice(nameStart, attributeEnd),
      rawValue,
      value: decodeHTMLAttribute(rawValue),
      quote,
      equalsOffset: equalsOffset === null ? null : sourceOffset + equalsOffset,
      range: {
        startOffset: sourceOffset + nameStart,
        endOffset: sourceOffset + attributeEnd,
      },
      nameRange: {
        startOffset: sourceOffset + nameStart,
        endOffset: sourceOffset + nameEnd,
      },
      valueRange: valueStart === null ? null : {
        startOffset: sourceOffset + valueStart,
        endOffset: sourceOffset + valueEnd,
      },
      removalRange: {
        startOffset: sourceOffset + nameStart,
        endOffset: sourceOffset + attributeEnd,
      },
    });
  }
  return attributes;
}

export function attributesFor(node) {
  return new Map(
    (node.attrs ?? []).map((attribute) => [
      attribute.name.toLowerCase(),
      attribute.value,
    ]),
  );
}

export function tokenFor(node) {
  const location = node.sourceCodeLocation;
  return {
    type: "startTag",
    name: node.tagName,
    start: location?.startTag?.startOffset ?? location?.startOffset,
    end: location?.startTag?.endOffset ?? location?.endOffset,
    attributes: attributesFor(node),
    node,
  };
}

export function visitElements(node, visitor, options = {}) {
  for (const child of node.childNodes ?? []) {
    if (typeof child.tagName === "string") visitor(child);
    visitElements(child, visitor, options);
  }
  if (options.includeTemplateContent && node.content) {
    visitElements(node.content, visitor, options);
  }
}

function findElement(document, tagName) {
  let result = null;
  visitElements(document, (node) => {
    if (!result && node.tagName === tagName) result = node;
  });
  return result;
}

function shiftSourceCodeLocation(location, delta) {
  if (!location || typeof location !== "object") return;
  if (Number.isInteger(location.startOffset)) location.startOffset += delta;
  if (Number.isInteger(location.endOffset)) location.endOffset += delta;
  if (location.startTag) shiftSourceCodeLocation(location.startTag, delta);
  if (location.endTag) shiftSourceCodeLocation(location.endTag, delta);
  if (location.attrs && typeof location.attrs === "object") {
    for (const value of Object.values(location.attrs)) {
      shiftSourceCodeLocation(value, delta);
    }
  }
}

function shiftTreeSourceCodeLocations(node, delta) {
  if (!node || typeof node !== "object") return;
  if (node.sourceCodeLocation) {
    shiftSourceCodeLocation(node.sourceCodeLocation, delta);
  }
  for (const child of node.childNodes ?? []) {
    shiftTreeSourceCodeLocations(child, delta);
  }
  if (node.content) shiftTreeSourceCodeLocations(node.content, delta);
}

export function parseHtmlSource(html) {
  const source = String(html);
  // parse5 drops html/head/body start-tag locations when the first character is
  // a UTF-8 BOM. Parse the BOM-free payload, then shift offsets back onto the
  // original string so identity materialization can still name those roots.
  const bomOffset = source.startsWith("\uFEFF") ? 1 : 0;
  const parseSource = bomOffset === 0 ? source : source.slice(bomOffset);
  const parseErrors = [];
  const document = parse(parseSource, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      parseErrors.push({ ...error });
    },
  });
  if (bomOffset !== 0) {
    shiftTreeSourceCodeLocations(document, bomOffset);
    for (const error of parseErrors) {
      if (Number.isInteger(error.startOffset)) error.startOffset += bomOffset;
      if (Number.isInteger(error.endOffset)) error.endOffset += bomOffset;
    }
  }
  const elements = [];
  visitElements(
    document,
    (node) => elements.push(tokenFor(node)),
    { includeTemplateContent: true },
  );
  return { source, document, elements, parseErrors };
}

export function removeElementTokens(html, predicate) {
  const parsed = parseHtmlSource(html);
  const removed = parsed.elements
    .filter(
      (token) =>
        Number.isInteger(token.start)
        && Number.isInteger(token.end)
        && predicate(token),
    )
    .sort((left, right) => left.start - right.start);
  if (removed.length === 0) return parsed.source;
  let result = "";
  let cursor = 0;
  for (const token of removed) {
    result += parsed.source.slice(cursor, token.start);
    cursor = token.end;
  }
  return result + parsed.source.slice(cursor);
}

function removeNodesFromTree(node, predicate) {
  if (Array.isArray(node.childNodes)) {
    node.childNodes = node.childNodes.filter((child) => {
      if (typeof child.tagName !== "string") return true;
      return !predicate(tokenFor(child));
    });
    for (const child of node.childNodes) {
      removeNodesFromTree(child, predicate);
    }
  }
  if (node.content) removeNodesFromTree(node.content, predicate);
}

export function serializeHtmlWithoutElementTokens(html, predicate) {
  const { document } = parseHtmlSource(html);
  removeNodesFromTree(document, predicate);
  return serialize(document);
}

export function firstEndTag(html, tagName) {
  const { document } = parseHtmlSource(html);
  const node = findElement(document, String(tagName).toLowerCase());
  const location = node?.sourceCodeLocation?.endTag;
  return location
    ? {
        type: "endTag",
        name: node.tagName,
        start: location.startOffset,
        end: location.endOffset,
      }
    : null;
}

/**
 * Document identity is accepted only from a real meta element under the
 * explicit document head. Template contents and body metadata cannot hijack
 * the project registry.
 */
export function metaContentByName(html, metaName) {
  const { document } = parseHtmlSource(html);
  const head = findElement(document, "head");
  if (!head?.sourceCodeLocation?.startTag || !head.sourceCodeLocation?.endTag) {
    return null;
  }
  const headContentStart = head.sourceCodeLocation.startTag.endOffset;
  const headContentEnd = head.sourceCodeLocation.endTag.startOffset;
  const normalized = String(metaName).toLowerCase();
  let result = null;
  visitElements(head, (node) => {
    const location = node.sourceCodeLocation;
    if (
      result === null
      && node.tagName === "meta"
      && node.parentNode === head
      && Number.isInteger(location?.startOffset)
      && Number.isInteger(location?.endOffset)
      && location.startOffset >= headContentStart
      && location.endOffset <= headContentEnd
      && attributesFor(node).get("name")?.toLowerCase() === normalized
    ) {
      result = attributesFor(node).get("content") ?? "";
    }
  });
  return result;
}

export function hasCompleteDocumentStructure(html) {
  const { document } = parseHtmlSource(html);
  const htmlElement = findElement(document, "html");
  const head = findElement(document, "head");
  const body = findElement(document, "body");
  const doctype = (document.childNodes ?? []).find(
    (node) => node.nodeName === "#documentType",
  );
  return Boolean(
    doctype?.name?.toLowerCase() === "html"
    && doctype.sourceCodeLocation
    && htmlElement?.sourceCodeLocation?.startTag
    && htmlElement.sourceCodeLocation?.endTag
    && head?.sourceCodeLocation?.startTag
    && head.sourceCodeLocation?.endTag
    && body?.sourceCodeLocation?.startTag
    && body.sourceCodeLocation?.endTag,
  );
}
