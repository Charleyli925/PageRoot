const CSS_PROPERTY_NAME = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/u;

export class SourceStyleValueError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourceStyleValueError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SourceStyleValueError(code, message, details);
}

function normalizePropertyName(property) {
  const value = String(property ?? "").trim();
  if (!CSS_PROPERTY_NAME.test(value)) {
    fail("INVALID_STYLE_PROPERTY", "Inline style property name is invalid.", { property });
  }
  return value.startsWith("--") ? value : value.toLowerCase();
}

function assertCommentFreeStyleSyntax(value, details = {}) {
  if (/\/\*|\*\//u.test(String(value ?? ""))) {
    fail(
      "UNSAFE_STYLE_SYNTAX",
      "Inline style comments cannot be edited safely without changing CSS meaning.",
      details,
    );
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
    if (char === '"' || char === "'") {
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
    if (closingDelimiters.length === 0 && (char === ";" || char === "!")) {
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

function encodeAttributeValueFragment(value, quote) {
  let result = String(value).replaceAll("&", "&amp;");
  if (quote === '"') return result.replaceAll('"', "&quot;");
  if (quote === "'") return result.replaceAll("'", "&#39;");
  return result
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\f", "&#12;")
    .replaceAll("\r", "&#13;")
    .replaceAll(" ", "&#32;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;")
    .replaceAll("=", "&#61;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function canonicalSourceStyleDeclaration({
  property,
  value,
  important,
  quote = '"',
  compact = false,
} = {}) {
  const normalizedProperty = normalizePropertyName(property);
  const details = { property: normalizedProperty };
  assertCommentFreeStyleSyntax(value, details);
  assertSingleCssValue(value, details);
  const separator = compact ? ":" : ": ";
  const importantSource = important ? (compact ? "!important" : " !important") : "";
  return {
    property: normalizedProperty,
    declaration: `${normalizedProperty}${separator}${
      encodeAttributeValueFragment(value, quote)
    }${importantSource}`,
  };
}
