import {
  EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
  EDIT_RUNTIME_OWNED_ATTRIBUTE,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
  isEditRuntimeEchartsCandidate,
  isEditRuntimeExecutionId,
  isEditRuntimeSessionId,
} from "../domain/edit-runtime-contract.js";

export const EDITOR_STYLE_ATTRIBUTE = "data-html-canvas-editor-style";
export const FRAME_VERIFICATION_ATTRIBUTE =
  "data-html-canvas-render-verification";

const INJECTED_BASE_ATTRIBUTE = "data-html-canvas-injected-base";
const DISABLED_SCRIPT_ATTRIBUTE = "data-html-canvas-disabled-script";
const ORIGINAL_SCRIPT_TYPE_ATTRIBUTE = "data-html-canvas-original-script-type";
const DISABLED_REFRESH_ATTRIBUTE = "data-html-canvas-disabled-refresh";
const MISSING_ATTRIBUTE_VALUE = "__html_canvas_missing__";
const SOURCE_NODE_ATTRIBUTE = "data-html-ai-source-node-id";

function escapeAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function disableExecutableMarkup(source) {
  return source.replace(
    /<script\b([^>]*)>/gi,
    (_openingTag, rawAttributes) => {
      const typePattern =
        /\s+type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
      const typeMatch = rawAttributes.match(typePattern);
      const originalType = typeMatch
        ? typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? ""
        : MISSING_ATTRIBUTE_VALUE;
      const attributesWithoutType = rawAttributes.replace(typePattern, "");
      return `<script${attributesWithoutType} type="application/x-html-canvas-disabled" ${DISABLED_SCRIPT_ATTRIBUTE}="true" ${ORIGINAL_SCRIPT_TYPE_ATTRIBUTE}="${escapeAttribute(originalType)}">`;
    },
  );
}

function doctypeString(doctype) {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

export function sanitizePreviewDocument(source, baseUrl) {
  const disabledSource = disableExecutableMarkup(source);
  if (typeof DOMParser === "undefined") return disabledSource;

  const parsed = new DOMParser().parseFromString(disabledSource, "text/html");
  parsed.querySelectorAll("meta[http-equiv]").forEach((node) => {
    const directive = node.getAttribute("http-equiv")?.trim().toLowerCase();
    if (directive === "refresh") {
      node.setAttribute(DISABLED_REFRESH_ATTRIBUTE, "true");
      node.setAttribute("http-equiv", "x-html-canvas-disabled-refresh");
    }
  });

  if (baseUrl && !parsed.head.querySelector("base")) {
    const base = parsed.createElement("base");
    base.href = baseUrl;
    base.setAttribute(INJECTED_BASE_ATTRIBUTE, "true");
    parsed.head.prepend(base);
  }
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

export function prepareVerifiedFrameDocument(
  source,
  verificationToken,
  { baseUrl, editorStyles } = {},
) {
  const sanitized = sanitizePreviewDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return sanitized;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  parsed.head
    .querySelectorAll(`style[${EDITOR_STYLE_ATTRIBUTE}]`)
    .forEach((node) => node.remove());
  const editorStyle = parsed.createElement("style");
  editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
  editorStyle.textContent = String(editorStyles || "");
  parsed.head.prepend(editorStyle);
  const marker = parsed.createElement("meta");
  marker.setAttribute(FRAME_VERIFICATION_ATTRIBUTE, verificationToken);
  marker.setAttribute("content", verificationToken);
  parsed.head.prepend(marker);
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

function browserPathForElement(root, target) {
  const path = [];
  let current = target;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const position = Array.prototype.indexOf.call(parent.children, current);
    if (position < 0) return null;
    path.unshift(position);
    current = parent;
  }
  return current === root ? path : null;
}

function elementAtBrowserPath(root, path) {
  let current = root;
  for (const position of path) {
    if (!Number.isSafeInteger(position) || position < 0) return null;
    current = current.children.item(position);
    if (!(current instanceof Element)) return null;
  }
  return current;
}

function sourceContentIsEmpty(element) {
  return Array.from(element.childNodes).every((node) => (
    node.nodeType === Node.COMMENT_NODE
    || (node.nodeType === Node.TEXT_NODE && !String(node.nodeValue || "").trim())
  ));
}

function runtimeHostMatches(element, binding) {
  return element instanceof Element
    && element.tagName.toLowerCase() === String(binding?.tagName || "").toLowerCase()
    && sourceContentIsEmpty(element)
    && Array.isArray(binding?.identityAttributes)
    && binding.identityAttributes.length > 0
    && binding.identityAttributes.every(([name, value]) => (
      element.getAttribute(name) === value
    ));
}

function uniqueRuntimeMarker(root, element) {
  const sourceId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
  if (sourceId) return sourceId;
  const path = browserPathForElement(root, element);
  return path ? `synthetic:${path.length ? path.join(".") : "root"}` : null;
}

function addFrameVerification(parsed, verificationToken, editorStyles) {
  parsed.head
    .querySelectorAll(`style[${EDITOR_STYLE_ATTRIBUTE}]`)
    .forEach((node) => node.remove());
  const editorStyle = parsed.createElement("style");
  editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
  editorStyle.textContent = String(editorStyles || "");
  parsed.head.prepend(editorStyle);
  const marker = parsed.createElement("meta");
  marker.setAttribute(FRAME_VERIFICATION_ATTRIBUTE, verificationToken);
  marker.setAttribute("content", verificationToken);
  parsed.head.prepend(marker);
}

/**
 * Builds the one disposable direct Edit runtime document. The only new
 * executable node is the PageRoot bootstrap URL; every authored program stays
 * a non-executable source stub until that bootstrap requests its fixed bytes
 * from Electron's one-use protocol session.
 */
export function prepareOneShotRuntimeFrameDocument(
  source,
  verificationToken,
  {
    sessionId,
    executionId,
    hosts,
    baseUrl,
    editorStyles,
  } = {},
) {
  if (
    typeof source !== "string"
    || !verificationToken
    || !isEditRuntimeSessionId(sessionId)
    || !isEditRuntimeExecutionId(executionId)
    || !Array.isArray(hosts)
    || hosts.length < 1
  ) return null;
  const scriptContract = collectEditRuntimeScripts(source);
  if (
    scriptContract.unsupportedReason
    || scriptContract.executableScripts.length < 1
    || !isEditRuntimeEchartsCandidate(source)
  ) return null;
  const sanitized = sanitizePreviewDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  if (!parsed.documentElement || !parsed.head) return null;
  const root = parsed.documentElement;
  const sourceElements = [root, ...root.querySelectorAll("*")];
  const seenMarkers = new Set();
  for (const element of sourceElements) {
    const marker = uniqueRuntimeMarker(root, element);
    if (!marker || seenMarkers.has(marker)) return null;
    seenMarkers.add(marker);
    element.setAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, marker);
  }
  const hostKeys = new Set();
  for (const binding of hosts) {
    if (
      !binding
      || typeof binding.key !== "string"
      || hostKeys.has(binding.key)
      || !Array.isArray(binding.path)
    ) return null;
    const element = elementAtBrowserPath(root, binding.path);
    if (!runtimeHostMatches(element, binding)) return null;
    hostKeys.add(binding.key);
    element.setAttribute(EDIT_RUNTIME_HOST_ATTRIBUTE, binding.key);
  }
  const scriptNodes = Array.from(parsed.querySelectorAll("script"));
  if (scriptNodes.length !== scriptContract.scripts.length) return null;
  for (let ordinal = 0; ordinal < scriptNodes.length; ordinal += 1) {
    const descriptor = scriptContract.scripts[ordinal];
    if (!descriptor?.executable) continue;
    const script = scriptNodes[ordinal];
    script.removeAttribute("src");
    script.removeAttribute("async");
    script.removeAttribute("defer");
    script.removeAttribute("nomodule");
    script.type = "application/x-pageroot-edit-runtime-source";
    script.setAttribute(EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE, String(descriptor.index));
    script.textContent = "";
  }
  addFrameVerification(parsed, String(verificationToken), editorStyles);
  const bootstrapUrl = editRuntimeProtocolUrl(
    sessionId,
    `/.pageroot/bootstrap/${executionId}.js`,
  );
  if (!bootstrapUrl || !bootstrapUrl.startsWith(`${EDIT_RUNTIME_PROTOCOL_SCHEME}:`)) {
    return null;
  }
  const bootstrap = parsed.createElement("script");
  bootstrap.src = bootstrapUrl;
  bootstrap.setAttribute(EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE, "true");
  bootstrap.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "bootstrap");
  parsed.head.prepend(bootstrap);
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

/**
 * The mode is intentionally discriminated: the static canvas may never gain
 * scripts through a boolean option, while one-shot runtime requires a fully
 * validated grant and its own document preparation path.
 */
export function prepareCanvasFrameDocument(
  source,
  verificationToken,
  options = {},
) {
  const { mode = "static", ...rest } = options;
  if (mode === "static") {
    return prepareVerifiedFrameDocument(source, verificationToken, rest);
  }
  if (mode === "one-shot-runtime") {
    return prepareOneShotRuntimeFrameDocument(source, verificationToken, rest);
  }
  throw new TypeError("Unknown HTML canvas frame mode.");
}

export function baseHrefFromSourcePath(sourcePath) {
  if (!sourcePath) return undefined;
  const trimmedPath = sourcePath.trim();
  if (!trimmedPath) return undefined;

  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      const sourceUrl = new URL(trimmedPath);
      if (!sourceUrl.pathname.endsWith("/")) {
        sourceUrl.pathname = sourceUrl.pathname.slice(
          0,
          sourceUrl.pathname.lastIndexOf("/") + 1,
        );
      }
      sourceUrl.search = "";
      sourceUrl.hash = "";
      return sourceUrl.href;
    }
  } catch {
    return undefined;
  }

  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("/")) return undefined;
  const directoryPath = normalizedPath.endsWith("/")
    ? normalizedPath
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
  const encodedPath = directoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encodedPath}`;
}
