/**
 * The Edit author-runtime contract intentionally has no DOM, Electron, or
 * persistence dependency. Both the desktop owner and the renderer use these
 * small syntactic rules to agree on which authored scripts may participate in a
 * one-shot execution. The source itself remains the authority; this module
 * only describes a disposable runtime grant.
 */

export const EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION = 1;

export const EDIT_AUTHOR_RUNTIME_BUDGET = Object.freeze({
  htmlBytes: 20 * 1024 * 1024,
  scriptCount: 24,
  scriptBytes: 3 * 1024 * 1024,
  aggregateScriptBytes: 12 * 1024 * 1024,
  hostCount: 16,
  sourceNodeCount: 4_096,
  mutationRecordCount: 4_096,
  cacheEntries: 8,
  cacheBytes: 32 * 1024 * 1024,
  cacheTtlMs: 30 * 60 * 1_000,
  ownerDeadlineMs: 4_500,
  geometryTolerancePx: 2,
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
 * A deliberately small HTML script scanner. `</script>` terminates a script in
 * the HTML parser even inside a JavaScript string, so matching that delimiter
 * is both conservative and aligned with browser parsing. Comments are skipped
 * so a documentation snippet cannot accidentally obtain an execution grant.
 */
export function collectEditRuntimeScripts(html) {
  const source = String(html ?? "");
  const scripts = [];
  let unsupportedReason = null;
  let cursor = 0;
  let activeIndex = 0;
  while (cursor < source.length) {
    const comment = source.indexOf("<!--", cursor);
    const opening = source.toLowerCase().indexOf("<script", cursor);
    if (comment >= 0 && (opening < 0 || comment < opening)) {
      const end = source.indexOf("-->", comment + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    if (opening < 0) break;
    const afterName = source[opening + 7] || "";
    if (!isNameBoundary(afterName)) {
      cursor = opening + 7;
      continue;
    }
    const openingEnd = htmlTagEnd(source, opening + 7);
    if (openingEnd < 0) break;
    const lower = source.toLowerCase();
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
    const executable = policy.executable;
    const entry = Object.freeze({
      startOffset: opening,
      endOffset: closingEnd + 1,
      openingTag,
      attributes,
      type: asciiLower(attributeValue(attributes, "type") || "").trim(),
      src: src === null ? null : src,
      inline: body,
      executable,
      index: executable ? activeIndex : null,
      reason: policy.reason,
    });
    scripts.push(entry);
    if (policy.reason) unsupportedReason ||= policy.reason;
    if (executable) activeIndex += 1;
    cursor = closingEnd + 1;
  }
  return Object.freeze({
    scripts: frozenArray(scripts),
    executableScripts: frozenArray(scripts.filter((script) => script.executable)),
    unsupportedReason,
  });
}

/**
 * Edit deliberately has a narrow product scope: it is an ECharts final-frame
 * path, not permission to execute an arbitrary page's classic scripts. A
 * declared ECharts library or a direct `echarts.init()` call is required before
 * the renderer may request a compatibility probe.
 */
export function isEditRuntimeEchartsCandidate(html) {
  const contract = collectEditRuntimeScripts(html);
  if (contract.unsupportedReason) return false;
  return contract.executableScripts.some((script) => (
    (typeof script.src === "string" && /(?:^|[/?#._-])echarts(?:[/?#._-]|$)/iu.test(script.src))
    || /\b(?:window\s*\.\s*)?echarts\s*\.\s*init\s*\(/u.test(script.inline)
  ));
}

/**
 * These are explicit non-goals for Edit. The owner checks the bytes after it
 * has resolved every local/CDN script, not just authored inline text.
 */
export function unsupportedEditRuntimeProgramReason(source) {
  const program = String(source || "");
  if (/\bimport\s*\(/u.test(program) || /\bimport\s+[^('"`]/u.test(program)) {
    return "dynamic-or-module-import";
  }
  if (/\b(?:Shared)?Worker\s*\(/u.test(program)) return "worker";
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/u.test(program)) {
    return "runtime-network";
  }
  if (/\b(?:navigator\.)?sendBeacon\s*\(/u.test(program)) return "runtime-network";
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
  return `${EDIT_RUNTIME_PROTOCOL_SCHEME}://${String(sessionId).toLowerCase()}${pathname}`;
}

export function isEditRuntimeProtocolUrl(value, sessionId = null) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === `${EDIT_RUNTIME_PROTOCOL_SCHEME}:`
      && isEditRuntimeSessionId(url.hostname)
      && (!sessionId || url.hostname === String(sessionId).toLowerCase());
  } catch {
    return false;
  }
}
