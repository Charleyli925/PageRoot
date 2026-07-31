import { parseFragment, serializeOuter } from "parse5";

const TABLE_CELL_TAGS = new Set(["td", "th"]);
const TABLE_INLINE_TAGS = new Set([
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "em",
  "i",
  "kbd",
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
  "wbr",
]);
const SAFE_STYLE_PROPERTIES = new Set([
  "background",
  "background-color",
  "color",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "vertical-align",
  "white-space",
]);
const CLASS_TOKEN_PATTERN = /^[\w-]{1,96}$/u;
const STYLE_VALUE_PATTERN = /^[#(),.%\s\w+-]{1,96}$/u;

function childNodesFor(node) {
  return node?.childNodes ?? [];
}

function findElement(node, tagName) {
  if (node?.tagName === tagName) return node;
  for (const child of childNodesFor(node)) {
    const match = findElement(child, tagName);
    if (match) return match;
  }
  return null;
}

function sanitizeClassName(value) {
  return String(value ?? "")
    .split(/\s+/u)
    .filter((token) => CLASS_TOKEN_PATTERN.test(token))
    .slice(0, 16)
    .join(" ");
}

function sanitizeStyle(value) {
  const declarations = [];
  for (const rawDeclaration of String(value ?? "").split(";")) {
    const separator = rawDeclaration.indexOf(":");
    if (separator <= 0) continue;
    const property = rawDeclaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = rawDeclaration.slice(separator + 1).trim();
    if (
      !SAFE_STYLE_PROPERTIES.has(property)
      || !STYLE_VALUE_PATTERN.test(propertyValue)
      || /(?:expression|url|javascript|@import|var\s*\()/iu.test(propertyValue)
    ) continue;
    declarations.push(`${property}:${propertyValue}`);
    if (declarations.length >= 16) break;
  }
  return declarations.join(";");
}

function sanitizeSpan(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100
    ? String(parsed)
    : "";
}

function sanitizeAttributes(node, { cell = false } = {}) {
  const next = [];
  for (const attribute of node.attrs ?? []) {
    const name = String(attribute.name ?? "").toLowerCase();
    if (name === "class") {
      const value = sanitizeClassName(attribute.value);
      if (value) next.push({ name, value });
    } else if (name === "style") {
      const value = sanitizeStyle(attribute.value);
      if (value) next.push({ name, value });
    } else if (cell && (name === "colspan" || name === "rowspan")) {
      const value = sanitizeSpan(attribute.value);
      if (value) next.push({ name, value });
    }
  }
  node.attrs = next;
}

function sanitizeInlineChildren(parent) {
  const nextChildren = [];
  for (const child of childNodesFor(parent)) {
    if (child.nodeName === "#text") {
      nextChildren.push(child);
      continue;
    }
    if (
      typeof child.tagName !== "string"
      || !TABLE_INLINE_TAGS.has(child.tagName.toLowerCase())
    ) continue;
    sanitizeAttributes(child);
    sanitizeInlineChildren(child);
    nextChildren.push(child);
  }
  parent.childNodes = nextChildren;
}

function sanitizeTableBody(body) {
  const rows = [];
  for (const row of childNodesFor(body)) {
    if (row?.tagName !== "tr") continue;
    sanitizeAttributes(row);
    const cells = [];
    for (const cell of childNodesFor(row)) {
      if (!TABLE_CELL_TAGS.has(String(cell?.tagName ?? "").toLowerCase())) continue;
      sanitizeAttributes(cell, { cell: true });
      sanitizeInlineChildren(cell);
      cells.push(cell);
    }
    if (cells.length === 0) continue;
    row.childNodes = cells;
    rows.push(row);
  }
  body.childNodes = rows;
}

export function sanitizeReadOnlyTableBodyHtml(value) {
  const source = String(value ?? "");
  if (!source || source.length > 512_000) return "";
  const fragment = parseFragment(`<table><tbody>${source}</tbody></table>`);
  const body = findElement(fragment, "tbody");
  if (!body) return "";
  sanitizeTableBody(body);
  return childNodesFor(body).map((node) => serializeOuter(node)).join("");
}

export function isSafePngDataUrl(value) {
  const source = String(value ?? "");
  return (
    source.length > 32
    && source.length <= 2_000_000
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(source)
  );
}
