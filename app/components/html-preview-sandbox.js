export const EDITOR_STYLE_ATTRIBUTE = "data-html-canvas-editor-style";
export const FRAME_VERIFICATION_ATTRIBUTE =
  "data-html-canvas-render-verification";

const INJECTED_BASE_ATTRIBUTE = "data-html-canvas-injected-base";
const DISABLED_SCRIPT_ATTRIBUTE = "data-html-canvas-disabled-script";
const ORIGINAL_SCRIPT_TYPE_ATTRIBUTE = "data-html-canvas-original-script-type";
const DISABLED_REFRESH_ATTRIBUTE = "data-html-canvas-disabled-refresh";
const MISSING_ATTRIBUTE_VALUE = "__html_canvas_missing__";

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
