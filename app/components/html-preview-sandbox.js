import {
  EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
  EDIT_RUNTIME_OWNED_ATTRIBUTE,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
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
const DISPLAY_POLICY_ATTRIBUTE = "data-pageroot-display-policy";
const MISSING_ATTRIBUTE_VALUE = "__html_canvas_missing__";
const SOURCE_NODE_ATTRIBUTE = "data-html-ai-source-node-id";
const EDIT_RUNTIME_CSP = [
  "default-src 'none'",
  "script-src pageroot-edit-runtime:",
  "style-src 'unsafe-inline' data: http: https: pageroot-edit-runtime:",
  "img-src data: blob: http: https: pageroot-edit-runtime:",
  "font-src data: http: https: pageroot-edit-runtime:",
  "media-src data: blob: http: https: pageroot-edit-runtime:",
  "connect-src http: https:",
  "worker-src blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
  "base-uri pageroot-edit-runtime:",
].join("; ");

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

/**
 * Builds a display-only document which still owns its native scroll viewport.
 * The iframe sandbox remains the executable boundary; this policy additionally
 * removes pointer/keyboard activation from authored controls without placing a
 * pointer-events fence over the whole document. Text selection, wheel and
 * trackpad scrolling therefore remain available while the authoritative Canvas
 * is prepared behind the projection.
 */
export function sanitizeScrollableDisplayDocument(source, baseUrl) {
  const sanitized = sanitizePreviewDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return sanitized;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  if (!parsed.documentElement || !parsed.head) return sanitized;
  parsed.documentElement.setAttribute(DISPLAY_POLICY_ATTRIBUTE, "scroll-only");
  parsed.querySelectorAll("[contenteditable]").forEach((node) => {
    node.setAttribute("contenteditable", "false");
  });
  parsed.querySelectorAll([
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "form",
    "[role='button']",
    "[role='link']",
    "[tabindex]",
  ].join(",")).forEach((node) => {
    node.setAttribute("tabindex", "-1");
    node.setAttribute("aria-disabled", "true");
  });
  const style = parsed.createElement("style");
  style.setAttribute(DISPLAY_POLICY_ATTRIBUTE, "style");
  style.textContent = `
    html, body { overscroll-behavior: contain; }
    a[href], button, input, select, textarea, form,
    [role="button"], [role="link"], [contenteditable] {
      pointer-events: none !important;
    }
  `;
  parsed.head.prepend(style);
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
  editorStyle.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "editor-style");
  editorStyle.textContent = String(editorStyles || "");
  parsed.head.prepend(editorStyle);
  const marker = parsed.createElement("meta");
  marker.setAttribute(FRAME_VERIFICATION_ATTRIBUTE, verificationToken);
  marker.setAttribute("content", verificationToken);
  marker.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "verification");
  parsed.head.prepend(marker);
}

function addRuntimeContentSecurityPolicy(parsed) {
  parsed.head
    .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    .forEach((node) => node.remove());
  const csp = parsed.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", EDIT_RUNTIME_CSP);
  csp.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "csp");
  parsed.head.prepend(csp);
}

/**
 * Runtime relative assets must resolve through the same immutable session as
 * the fixed author scripts.  `srcdoc` is intentionally retained for direct
 * editor DOM access, so the protocol base—not the iframe URL—closes this
 * capability boundary.
 */
function addRuntimeResourceBase(parsed, sessionId) {
  const resourceBase = editRuntimeProtocolUrl(sessionId, "/");
  if (!resourceBase || !parsed.head) return false;
  parsed.head.querySelectorAll("base").forEach((node) => node.remove());
  const base = parsed.createElement("base");
  base.href = resourceBase;
  base.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "resource-base");
  parsed.head.prepend(base);
  return true;
}

/**
 * Builds one disposable Edit runtime document. Native script elements load
 * through a source-scoped protocol session, so browser ordering semantics run
 * normally without widening the renderer's own CSP. No Runtime DOM is ever
 * serialized back into the source HTML.
 */
export function prepareDisposableRuntimeFrameDocument(
  source,
  verificationToken,
  {
    sessionId,
    executionId,
    baseUrl,
    editorStyles,
  } = {},
) {
  if (
    typeof source !== "string"
    || !verificationToken
    || !isEditRuntimeSessionId(sessionId)
    || !isEditRuntimeExecutionId(executionId)
  ) return null;
  const scriptContract = collectEditRuntimeScripts(source);
  if (
    scriptContract.unsupportedReason
    || scriptContract.executableScripts.length < 1
  ) return null;
  const sanitized = sanitizePreviewDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  if (!parsed.documentElement || !parsed.head) return null;
  if (!addRuntimeResourceBase(parsed, sessionId)) return null;
  const root = parsed.documentElement;
  const sourceElements = [root, ...root.querySelectorAll("*")];
  const seenMarkers = new Set();
  for (const element of sourceElements) {
    const marker = uniqueRuntimeMarker(root, element);
    if (!marker || seenMarkers.has(marker)) return null;
    seenMarkers.add(marker);
    element.setAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, marker);
  }
  const scriptNodes = Array.from(parsed.querySelectorAll("script"));
  if (scriptNodes.length !== scriptContract.scripts.length) return null;
  for (let ordinal = 0; ordinal < scriptNodes.length; ordinal += 1) {
    const descriptor = scriptContract.scripts[ordinal];
    if (!descriptor?.executable) continue;
    const script = scriptNodes[ordinal];
    const scriptUrl = editRuntimeProtocolUrl(
      sessionId,
      `/.pageroot/author/${descriptor.index}.js`,
    );
    if (!scriptUrl) return null;
    script.src = scriptUrl;
    if (descriptor.type) script.type = descriptor.type;
    else script.removeAttribute("type");
    script.setAttribute(EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE, String(descriptor.index));
    script.textContent = "";
  }
  addFrameVerification(parsed, String(verificationToken), editorStyles);
  addRuntimeContentSecurityPolicy(parsed);
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
 * A discriminated frame builder keeps script-free pages static and uses the
 * disposable runtime only with a complete Main-authorized resource grant.
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
  if (mode === "disposable-runtime") {
    return prepareDisposableRuntimeFrameDocument(source, verificationToken, rest);
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
