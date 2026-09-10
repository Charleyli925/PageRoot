import { parse as parseHtmlDocument } from "parse5";

/**
 * Pure syntax and identity rules for the bounded Edit author-runtime path.
 * This contract describes a disposable direct-frame grant only: source HTML
 * remains the persistence authority at every point. The grant never carries
 * screenshots, PNG bytes or a second visual representation.
 */

export const EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION = 2;

export const EDIT_AUTHOR_RUNTIME_BUDGET = Object.freeze({
  htmlBytes: 20 * 1024 * 1024,
  scriptCount: 24,
  scriptBytes: 3 * 1024 * 1024,
  aggregateScriptBytes: 12 * 1024 * 1024,
  declaredAssetCount: 64,
  declaredAssetReferenceCount: 128,
  declaredAssetBytes: 2 * 1024 * 1024,
  remoteLibraryDeadlineMs: 60_000,
  runtimeDeadlineMs: 4_000,
  runtimeSurfaceDeadlineMs: 12_000,
  orphanSessionTtlMs: 60_000,
});

// Main first bounds immutable resource preparation. The visible Edit iframe
// acknowledges its ordinary load directly; runtimeDeadlineMs is only a
// fail-safe for hostile or broken author code and never a minimum wait.
export const EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS = (
  EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs
  + EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
  + EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs
) + 1_000;

export const EDIT_RUNTIME_PROTOCOL_SCHEME = "pageroot-edit-runtime";
export const EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE =
  "data-pageroot-edit-runtime-source";
export const EDIT_RUNTIME_OWNED_ATTRIBUTE =
  "data-pageroot-edit-runtime-owned";
export const EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE =
  "data-pageroot-edit-runtime-script";
export const EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE =
  "data-pageroot-edit-runtime-bootstrap";

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const EXECUTION_ID_PATTERN = /^[a-f0-9]{24}$/u;
const REQUEST_ID_PATTERN = /^edit-runtime-[a-z0-9][a-z0-9_-]{7,127}$/u;
const SOURCE_SHA_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FRAME_TOKEN_PATTERN = /^edit-runtime-frame-[a-f0-9]{24}$/u;
const CLASSIC_SCRIPT_TYPES = new Set([
  "",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function frozenArray(value) {
  return Object.freeze([...value]);
}

function asciiLower(value) {
  return String(value || "").toLowerCase();
}

function isNameBoundary(value) {
  return value === "" || /[\t\n\f\r />]/u.test(value);
}

function htmlTagEnd(source, start) {
  let quote = "";
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return cursor;
  }
  return -1;
}

function attributesFromOpeningTag(openingTag) {
  const attributes = [];
  let cursor = 0;
  while (cursor < openingTag.length && openingTag[cursor] !== "<") cursor += 1;
  cursor += 1;
  while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
  while (
    cursor < openingTag.length
    && !/[\t\n\f\r />]/u.test(openingTag[cursor])
  ) cursor += 1;
  while (cursor < openingTag.length) {
    while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
    if (cursor >= openingTag.length || openingTag[cursor] === ">") break;
    if (openingTag[cursor] === "/" && openingTag[cursor + 1] === ">") break;
    const nameStart = cursor;
    while (
      cursor < openingTag.length
      && !/[\t\n\f\r =>/]/u.test(openingTag[cursor])
    ) cursor += 1;
    const rawName = openingTag.slice(nameStart, cursor);
    if (!rawName) {
      cursor += 1;
      continue;
    }
    while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
    let value = null;
    if (openingTag[cursor] === "=") {
      cursor += 1;
      while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
      const quote = openingTag[cursor] === "\"" || openingTag[cursor] === "'"
        ? openingTag[cursor]
        : "";
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < openingTag.length && openingTag[cursor] !== quote) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
        if (openingTag[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (
          cursor < openingTag.length
          && !/[\t\n\f\r >]/u.test(openingTag[cursor])
        ) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
      }
    }
    attributes.push(Object.freeze({ name: asciiLower(rawName), value }));
  }
  return frozenArray(attributes);
}

function attributeValue(attributes, name) {
  const normalized = asciiLower(name);
  const matches = attributes.filter((attribute) => attribute.name === normalized);
  return matches.length === 1 ? matches[0].value ?? "" : null;
}

function scriptPolicy(attributes) {
  const rawType = attributeValue(attributes, "type");
  const type = asciiLower(rawType || "").trim();
  if (type === "module") return Object.freeze({ executable: true, reason: null });
  if (!CLASSIC_SCRIPT_TYPES.has(type)) {
    return Object.freeze({ executable: false, reason: null });
  }
  return Object.freeze({ executable: true, reason: null });
}

/**
 * Returns the first authored, live-document <base href> using HTML parser tree
 * order. A base without href does not win, and inert template contents never
 * participate in the document base URL.
 */
export function authoredDocumentBase(html) {
  const source = String(html || "");
  let document;
  try {
    document = parseHtmlDocument(source, { sourceCodeLocationInfo: true });
  } catch {
    return null;
  }
  let result = null;
  const visit = (node) => {
    if (result) return;
    if (
      node?.namespaceURI === HTML_NAMESPACE
      && String(node?.tagName || "").toLowerCase() === "base"
    ) {
      const hrefAttribute = (node.attrs || []).find((attribute) => (
        String(attribute.name || "").toLowerCase() === "href"
      ));
      const startTag = node.sourceCodeLocation?.startTag;
      if (hrefAttribute && startTag) {
        result = Object.freeze({
          href: String(hrefAttribute.value || ""),
          openingTag: source.slice(startTag.startOffset, startTag.endOffset),
        });
        return;
      }
    }
    // parse5 stores template descendants in node.content. Deliberately visit
    // only live childNodes: inert template contents cannot set document.baseURI.
    for (const child of node?.childNodes || []) visit(child);
  };
  visit(document);
  return result;
}

/**
 * Scans HTML executable script elements. The parser also treats a closing
 * script tag inside a JavaScript string as a terminator, so this deliberately
 * conservative scanner follows browser parsing instead of inventing JS rules.
 */
export function collectEditRuntimeScripts(html) {
  const source = String(html ?? "");
  const scripts = [];
  let unsupportedReason = null;
  let cursor = 0;
  let activeIndex = 0;
  const lower = source.toLowerCase();
  while (cursor < source.length) {
    const comment = source.indexOf("<!--", cursor);
    const opening = lower.indexOf("<script", cursor);
    if (comment >= 0 && (opening < 0 || comment < opening)) {
      const end = source.indexOf("-->", comment + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    if (opening < 0) break;
    if (!isNameBoundary(source[opening + 7] || "")) {
      cursor = opening + 7;
      continue;
    }
    const openingEnd = htmlTagEnd(source, opening + 7);
    if (openingEnd < 0) break;
    let closingStart = lower.indexOf("</script", openingEnd + 1);
    while (closingStart >= 0 && !isNameBoundary(source[closingStart + 8] || "")) {
      closingStart = lower.indexOf("</script", closingStart + 8);
    }
    if (closingStart < 0) {
      unsupportedReason ||= "unterminated-script";
      break;
    }
    const closingEnd = htmlTagEnd(source, closingStart + 8);
    if (closingEnd < 0) {
      unsupportedReason ||= "unterminated-script";
      break;
    }
    const openingTag = source.slice(opening, openingEnd + 1);
    const attributes = attributesFromOpeningTag(openingTag);
    const policy = scriptPolicy(attributes);
    const src = attributeValue(attributes, "src");
    const body = source.slice(openingEnd + 1, closingStart);
    const entry = Object.freeze({
      startOffset: opening,
      endOffset: closingEnd + 1,
      openingTag,
      attributes,
      type: asciiLower(attributeValue(attributes, "type") || "").trim(),
      src: src === null ? null : src,
      inline: body,
      executable: policy.executable,
      index: policy.executable ? activeIndex : null,
      reason: policy.reason,
    });
    scripts.push(entry);
    if (policy.reason) unsupportedReason ||= policy.reason;
    if (policy.executable) activeIndex += 1;
    cursor = closingEnd + 1;
  }
  return Object.freeze({
    scripts: frozenArray(scripts),
    executableScripts: frozenArray(scripts.filter((script) => script.executable)),
    unsupportedReason,
  });
}

/**
 * Exact authored-script identity used to decide whether one disposable Edit
 * resource session can render a later semantic HTML revision. Ordinary text,
 * style and structure edits leave this value unchanged; script edits require a
 * new Canvas generation and a new Main-authorized resource closure.
 */
export function editRuntimeProgramIdentity(html) {
  const contract = collectEditRuntimeScripts(html);
  if (contract.unsupportedReason || contract.executableScripts.length < 1) return null;
  return JSON.stringify({
    documentBase: authoredDocumentBase(html)?.openingTag || null,
    scripts: contract.executableScripts.map((script) => ({
      openingTag: script.openingTag,
      inline: script.inline,
    })),
  });
}

function skipJavaScriptQuotedLiteral(source, start, quote) {
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    cursor += 1;
    if (character === quote) break;
  }
  return cursor;
}

function skipJavaScriptComment(source, start) {
  if (source[start + 1] === "/") {
    let cursor = start + 2;
    while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") {
      cursor += 1;
    }
    return cursor;
  }
  if (source[start + 1] === "*") {
    const end = source.indexOf("*/", start + 2);
    return end < 0 ? source.length : end + 2;
  }
  return start;
}

function skipJavaScriptTrivia(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    const commentEnd = source[cursor] === "/"
      ? skipJavaScriptComment(source, cursor)
      : cursor;
    if (commentEnd === cursor) break;
    cursor = commentEnd;
  }
  return cursor;
}

function skipJavaScriptRegexLiteral(source, start) {
  let cursor = start + 1;
  let inCharacterClass = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "[") inCharacterClass = true;
    if (character === "]") inCharacterClass = false;
    cursor += 1;
    if (character === "/" && !inCharacterClass) break;
    if (character === "\n" || character === "\r") break;
  }
  while (cursor < source.length && /[a-z]/iu.test(source[cursor])) cursor += 1;
  return cursor;
}

function containsJavaScriptImportSyntax(source) {
  let found = false;
  const expressionKeywords = new Set([
    "await", "case", "delete", "do", "else", "in", "instanceof", "new",
    "of", "return", "throw", "typeof", "void", "yield",
  ]);
  const blockOpeningKeywords = new Set(["do", "else", "finally", "try"]);
  let scanCode;

  const scanTemplate = (start) => {
    let cursor = start + 1;
    while (cursor < source.length && !found) {
      const character = source[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "`") return cursor + 1;
      if (character === "$" && source[cursor + 1] === "{") {
        cursor = scanCode(cursor + 2, true);
        continue;
      }
      cursor += 1;
    }
    return cursor;
  };

  scanCode = (start, stopAtClosingBrace = false) => {
    let cursor = start;
    const braceKinds = [];
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let pendingClassBody = null;
    let expressionExpected = true;
    let previousToken = "";
    while (cursor < source.length && !found) {
      const character = source[cursor];
      if (/\s/u.test(character)) {
        cursor += 1;
        continue;
      }
      if (character === "'" || character === '"') {
        cursor = skipJavaScriptQuotedLiteral(source, cursor, character);
        expressionExpected = false;
        previousToken = "literal";
        continue;
      }
      if (character === "`") {
        cursor = scanTemplate(cursor);
        expressionExpected = false;
        previousToken = "literal";
        continue;
      }
      if (character === "/") {
        const commentEnd = skipJavaScriptComment(source, cursor);
        if (commentEnd !== cursor) {
          cursor = commentEnd;
          continue;
        }
        if (expressionExpected) {
          cursor = skipJavaScriptRegexLiteral(source, cursor);
          expressionExpected = false;
          previousToken = "literal";
        } else {
          cursor += source[cursor + 1] === "=" ? 2 : 1;
          expressionExpected = true;
          previousToken = "/";
        }
        continue;
      }
      if (/[A-Za-z_$]/u.test(character)) {
        const match = /^[A-Za-z_$][\w$]*/u.exec(source.slice(cursor));
        const identifier = match?.[0] || character;
        const next = skipJavaScriptTrivia(source, cursor + identifier.length);
        const memberPrefix = ["{", ",", "}", ";", "*", "get", "set", "async", "static"]
          .includes(previousToken);
        const importPropertyMethod = source[next] === "("
          && (
            (braceKinds.at(-1) === "object" && memberPrefix)
            || (braceKinds.at(-1) === "class" && memberPrefix)
          );
        const importClassMember = identifier === "import"
          && braceKinds.at(-1) === "class"
          && memberPrefix;
        if (
          identifier === "import"
          && previousToken !== "."
          && previousToken !== "?."
          && source[next] !== ":"
          && !importPropertyMethod
          && !importClassMember
        ) {
          found = true;
          return source.length;
        }
        cursor += identifier.length;
        if (identifier === "class" && previousToken !== "." && previousToken !== "?.") {
          pendingClassBody = { parenthesisDepth, bracketDepth };
        }
        expressionExpected = expressionKeywords.has(identifier);
        previousToken = identifier;
        continue;
      }
      if (/[0-9]/u.test(character)) {
        const match = /^(?:0[xob][0-9a-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/iu.exec(
          source.slice(cursor),
        );
        cursor += match?.[0].length || 1;
        expressionExpected = false;
        previousToken = "literal";
        continue;
      }
      if (character === "{") {
        const opensClassBody = pendingClassBody
          && pendingClassBody.parenthesisDepth === parenthesisDepth
          && pendingClassBody.bracketDepth === bracketDepth;
        braceKinds.push(
          opensClassBody
            ? "class"
            : !expressionExpected
          || previousToken === "=>"
          || blockOpeningKeywords.has(previousToken)
            ? "block"
            : "object",
        );
        if (opensClassBody) pendingClassBody = null;
        cursor += 1;
        expressionExpected = true;
        previousToken = "{";
        continue;
      }
      if (character === "}") {
        if (stopAtClosingBrace && braceKinds.length === 0) return cursor + 1;
        const braceKind = braceKinds.pop();
        cursor += 1;
        expressionExpected = braceKind === "block";
        previousToken = "}";
        continue;
      }
      const threeCharacters = source.slice(cursor, cursor + 3);
      const twoCharacters = source.slice(cursor, cursor + 2);
      const token = threeCharacters === "..."
        ? threeCharacters
        : ["?.", "=>"].includes(twoCharacters)
          ? twoCharacters
          : character;
      cursor += token.length;
      if (token === "(") parenthesisDepth += 1;
      if (token === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      if (token === "[") bracketDepth += 1;
      if (token === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      expressionExpected = ![")", "]"].includes(token);
      previousToken = token;
    }
    return cursor;
  };

  scanCode(0);
  return found;
}

/**
 * Relative module imports still need a native module graph rooted in the
 * authored file. Until that graph is served by the scoped protocol, reject
 * only import syntax and let CSP remain the boundary for ordinary APIs.
 */
export function unsupportedEditRuntimeProgramReason(source) {
  const program = String(source || "");
  if (containsJavaScriptImportSyntax(program)) {
    return "dynamic-or-module-import";
  }
  return null;
}

export function editRuntimeSourceMarker(path) {
  if (!Array.isArray(path) || path.some((item) => !Number.isSafeInteger(item) || item < 0)) {
    return null;
  }
  return path.length === 0 ? "root" : path.join(".");
}

export function isEditRuntimeSessionId(value) {
  return SESSION_ID_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeExecutionId(value) {
  return EXECUTION_ID_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ""));
}

export function isEditRuntimeSourceSha256(value) {
  return SOURCE_SHA_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeFrameToken(value) {
  return FRAME_TOKEN_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeDocumentBasePath(value) {
  const pathname = String(value || "");
  if (
    !pathname.startsWith("/")
    || pathname.length > 4_096
    || /[?#\\\0]/u.test(pathname)
  ) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return !decoded.split("/").some((segment) => (
    segment === ".." || segment.startsWith(".")
  ));
}

export function editRuntimeRegistrationProperty(executionId) {
  const normalized = String(executionId || "").toLowerCase();
  return isEditRuntimeExecutionId(normalized)
    ? `__pageroot_edit_register_${normalized}`
    : null;
}

export function editRuntimeProtocolUrl(sessionId, path) {
  if (!isEditRuntimeSessionId(sessionId)) return null;
  const pathname = String(path || "");
  if (!pathname.startsWith("/")) return null;
  return EDIT_RUNTIME_PROTOCOL_SCHEME + "://" + String(sessionId).toLowerCase() + pathname;
}

export function isEditRuntimeProtocolUrl(value, sessionId = null) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === EDIT_RUNTIME_PROTOCOL_SCHEME + ":"
      && isEditRuntimeSessionId(url.hostname)
      && (!sessionId || url.hostname === String(sessionId).toLowerCase());
  } catch {
    return false;
  }
}
