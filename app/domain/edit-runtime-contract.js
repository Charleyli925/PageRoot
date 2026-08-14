/**
 * Pure syntax and identity rules for the bounded Edit author-runtime path.
 * This contract describes a disposable final-frame grant only: source HTML
 * remains the persistence authority at every point.
 */

export const EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION = 1;

export const EDIT_AUTHOR_RUNTIME_BUDGET = Object.freeze({
  htmlBytes: 20 * 1024 * 1024,
  scriptCount: 24,
  scriptBytes: 3 * 1024 * 1024,
  aggregateScriptBytes: 12 * 1024 * 1024,
  hostCount: 32,
  sourceNodeCount: 4_096,
  runtimeSettleMs: 1_200,
  runtimeDeadlineMs: 4_000,
  // A frozen isolated render may return only bounded host pixels to static
  // Edit. These values intentionally mirror the established presentation
  // budget rather than granting the renderer a general capture channel.
  snapshotBytes: 2_000_000,
  snapshotAggregateBytes: 16_000_000,
  snapshotPixels: 4_194_304,
  snapshotAggregatePixels: 4_194_304,
  snapshotDimension: 4_096,
  orphanSessionTtlMs: 60_000,
});

export const EDIT_RUNTIME_PROTOCOL_SCHEME = "pageroot-edit-runtime";
export const EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE =
  "data-pageroot-edit-runtime-source";
export const EDIT_RUNTIME_HOST_ATTRIBUTE =
  "data-pageroot-edit-runtime-host";
export const EDIT_RUNTIME_OWNED_ATTRIBUTE =
  "data-pageroot-edit-runtime-owned";
export const EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE =
  "data-pageroot-edit-runtime-script";
export const EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE =
  "data-pageroot-edit-runtime-bootstrap";
export const EDIT_RUNTIME_FROZEN_ATTRIBUTE =
  "data-pageroot-edit-runtime-frozen";
export const EDIT_RUNTIME_RESULT_ATTRIBUTE =
  "data-pageroot-edit-runtime-result";

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

function hasAttribute(attributes, name) {
  return attributes.some((attribute) => attribute.name === asciiLower(name));
}

function scriptPolicy(attributes) {
  const rawType = attributeValue(attributes, "type");
  const type = asciiLower(rawType || "").trim();
  if (type === "module") return Object.freeze({ executable: false, reason: "module-script" });
  if (!CLASSIC_SCRIPT_TYPES.has(type)) {
    return Object.freeze({ executable: false, reason: null });
  }
  if (hasAttribute(attributes, "async") || hasAttribute(attributes, "defer")) {
    return Object.freeze({ executable: false, reason: "non-deterministic-script" });
  }
  if (hasAttribute(attributes, "nomodule")) {
    return Object.freeze({ executable: false, reason: "nomodule-script" });
  }
  return Object.freeze({ executable: true, reason: null });
}

/**
 * Scans only HTML classic-script elements. The parser also treats a closing
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

export function hasEditRuntimeEchartsSignal(source) {
  const value = String(source || "");
  return /(?:^|[/?#._-])echarts(?:[/?#._-]|$)/iu.test(value)
    || /\b(?:window\s*\.\s*)?echarts\s*\.\s*init\s*\(/u.test(value);
}

/**
 * Edit does not grant arbitrary script execution. A classic-script document
 * needs an explicit ECharts library or initializer signal before preparation.
 */
export function isEditRuntimeEchartsCandidate(html) {
  const contract = collectEditRuntimeScripts(html);
  return !contract.unsupportedReason
    && contract.executableScripts.some((script) => (
      hasEditRuntimeEchartsSignal(script.src || "")
      || hasEditRuntimeEchartsSignal(script.inline)
    ));
}

/**
 * Modules and dynamic imports remain outside the one-shot ordered-classic
 * contract. Network and worker APIs are intentionally not predicted here:
 * CSP is the runtime boundary, avoiding false static fallbacks from strings.
 */
export function unsupportedEditRuntimeProgramReason(source) {
  const program = String(source || "");
  if (/\bimport\s*\(/u.test(program) || /\bimport\s+[^('"\x60]/u.test(program)) {
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
