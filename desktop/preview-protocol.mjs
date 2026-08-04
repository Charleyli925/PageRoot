import { randomBytes } from "node:crypto";
import {
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";

export const PREVIEW_PROTOCOL_SCHEME = "pageroot-preview";
export const PREVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";

const DEFAULT_MAX_HTML_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_DECLARED_ASSETS = 256;
const DEFAULT_MAX_DEPENDENCY_SCAN_BYTES = 2 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const ASSET_REFERENCE_ORIGIN = "https://pageroot-preview.invalid";
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const FONT_EXTENSIONS = new Set([".otf", ".ttf", ".woff", ".woff2"]);
const MEDIA_EXTENSIONS = new Set([
  ".m4a",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".ogv",
  ".wav",
  ".webm",
]);
const CSS_URL_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...FONT_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
]);
const PREVIEW_DOCUMENT_CSP = [
  "default-src 'self' http: https: data: blob:",
  "script-src 'self' http: https: data: blob: 'unsafe-inline'",
  "style-src 'self' http: https: data: blob: 'unsafe-inline'",
  "img-src 'self' http: https: data: blob:",
  "font-src 'self' http: https: data: blob:",
  "media-src 'self' http: https: data: blob:",
  "connect-src 'self' http: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' http: https:",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

let schemePrivilegesRegistered = false;

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function response(body, status, contentType, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function notFound() {
  return response("Not found", 404, "text/plain; charset=utf-8");
}

function invalidRequest() {
  return response("Invalid preview request", 400, "text/plain; charset=utf-8");
}

function isContainedPath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveSourceRoot(sourcePath) {
  if (sourcePath === undefined || sourcePath === null || sourcePath === "") {
    return null;
  }
  if (
    typeof sourcePath !== "string"
    || sourcePath.length > 4096
    || !path.isAbsolute(sourcePath)
  ) {
    throw new TypeError("Preview sourcePath must be an absolute local path.");
  }
  const sourceRealPath = await realpath(sourcePath);
  const sourceInfo = await stat(sourceRealPath);
  if (!sourceInfo.isFile()) {
    throw new TypeError("Preview sourcePath must resolve to a regular file.");
  }
  return realpath(path.dirname(sourceRealPath));
}

function normalizeRelativeAssetPath(value, basePath = "") {
  if (typeof value !== "string") return null;
  const reference = value.trim();
  if (!reference || reference.length > 4096 || reference.startsWith("#")) {
    return null;
  }

  let parsed;
  try {
    const baseUrl = new URL(
      `${ASSET_REFERENCE_ORIGIN}/${basePath.replace(/^\/+|\/+$/gu, "")}`,
    );
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
    parsed = new URL(reference, baseUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== ASSET_REFERENCE_ORIGIN) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (!decodedPath || decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return null;
  }
  const normalizedPath = path.posix.normalize(decodedPath).replace(/^\/+/, "");
  if (
    !normalizedPath
    || normalizedPath === "."
    || normalizedPath === ".."
    || normalizedPath.startsWith("../")
  ) return null;
  if (normalizedPath.split("/").some((segment) => segment.startsWith("."))) {
    return null;
  }
  return normalizedPath;
}

function extensionForAsset(relativePath) {
  return path.posix.extname(relativePath).toLowerCase();
}

function isAllowedAssetType(relativePath, extensions) {
  return extensions.has(extensionForAsset(relativePath));
}

function attributesFor(node) {
  return new Map((node.attrs || []).map((attribute) => [
    String(attribute.name || "").toLowerCase(),
    String(attribute.value || ""),
  ]));
}

function appendSrcSetReferences(value, extensions, append) {
  if (typeof value !== "string") return;
  for (const candidate of value.split(",")) {
    const reference = candidate.trim().split(/\s+/u)[0];
    if (reference) append(reference, extensions);
  }
}

function textContentFor(node) {
  if (typeof node?.value === "string") return node.value;
  return (node?.childNodes || []).map((child) => textContentFor(child)).join("");
}

function collectHtmlAssetReferences(html) {
  const references = [];
  const append = (value, extensions) => {
    references.push({ value, extensions, basePath: "" });
  };
  const visit = (node) => {
    const tagName = String(node.tagName || "").toLowerCase();
    const attributes = attributesFor(node);
    const inlineStyle = cssReferences(attributes.get("style") || "");
    for (const value of inlineStyle.urls) {
      append(value, CSS_URL_EXTENSIONS);
    }
    if (tagName === "script") {
      append(attributes.get("src"), SCRIPT_EXTENSIONS);
      if (
        !attributes.get("src")
        && (attributes.get("type") || "").trim().toLowerCase() === "module"
      ) {
        for (const value of javaScriptImports(textContentFor(node))) {
          append(value, SCRIPT_EXTENSIONS);
        }
      }
    } else if (tagName === "style") {
      const inlineStylesheet = cssReferences(textContentFor(node));
      for (const value of inlineStylesheet.imports) {
        append(value, STYLE_EXTENSIONS);
      }
      for (const value of inlineStylesheet.urls) {
        append(value, CSS_URL_EXTENSIONS);
      }
    } else if (tagName === "link") {
      const rel = (attributes.get("rel") || "")
        .toLowerCase()
        .split(/\s+/u);
      if (rel.includes("stylesheet")) {
        append(attributes.get("href"), STYLE_EXTENSIONS);
      } else if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
        append(attributes.get("href"), IMAGE_EXTENSIONS);
      } else if (rel.includes("preload")) {
        const as = (attributes.get("as") || "").toLowerCase();
        const extensions = as === "style"
          ? STYLE_EXTENSIONS
          : as === "script"
            ? SCRIPT_EXTENSIONS
            : as === "font"
              ? FONT_EXTENSIONS
              : as === "image"
                ? IMAGE_EXTENSIONS
                : MEDIA_EXTENSIONS;
        append(attributes.get("href"), extensions);
      }
    } else if (tagName === "img") {
      append(attributes.get("src"), IMAGE_EXTENSIONS);
      appendSrcSetReferences(attributes.get("srcset"), IMAGE_EXTENSIONS, append);
    } else if (tagName === "source") {
      const type = (attributes.get("type") || "").toLowerCase();
      const extensions = type.startsWith("image/")
        ? IMAGE_EXTENSIONS
        : MEDIA_EXTENSIONS;
      append(attributes.get("src"), extensions);
      appendSrcSetReferences(attributes.get("srcset"), extensions, append);
    } else if (tagName === "video" || tagName === "audio" || tagName === "track") {
      append(attributes.get("src"), MEDIA_EXTENSIONS);
      if (tagName === "video") append(attributes.get("poster"), IMAGE_EXTENSIONS);
    } else if (tagName === "image" || tagName === "use") {
      append(attributes.get("href") || attributes.get("xlink:href"), IMAGE_EXTENSIONS);
    } else if (tagName === "input") {
      if ((attributes.get("type") || "").toLowerCase() === "image") {
        append(attributes.get("src"), IMAGE_EXTENSIONS);
      }
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  try {
    visit(parse(html));
  } catch {
    return [];
  }
  return references;
}

function cssReferences(css) {
  const imports = [];
  const urls = [];
  const importPattern = /@import\s+(?:url\(\s*)?(["']?)([^"'\s)]+)\1\s*\)?/giu;
  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
  for (const match of css.matchAll(importPattern)) imports.push(match[2]);
  for (const match of css.matchAll(urlPattern)) urls.push(match[2]);
  return { imports, urls };
}

function javaScriptImports(source) {
  const references = [];
  const pattern = /(?:\bimport\s*(?:[\w*${},\s]*?\s+from\s*)?|\bexport\s+(?:[\w*${},\s]*?\s+from\s*)?|\bimport\s*\(\s*)(["'])([^"']+)\1/giu;
  for (const match of source.matchAll(pattern)) references.push(match[2]);
  return references;
}

async function resolveDeclaredAsset(sourceRoot, relativePath) {
  const candidatePath = path.resolve(
    sourceRoot,
    ...relativePath.split("/"),
  );
  if (!isContainedPath(sourceRoot, candidatePath)) return null;
  try {
    const resolvedPath = await realpath(candidatePath);
    if (!isContainedPath(sourceRoot, resolvedPath)) return null;
    const fileInfo = await stat(resolvedPath);
    return fileInfo.isFile() ? resolvedPath : null;
  } catch {
    return null;
  }
}

async function collectDeclaredAssets({
  html,
  sourceRoot,
  maxAssets = DEFAULT_MAX_DECLARED_ASSETS,
  maxDependencyScanBytes = DEFAULT_MAX_DEPENDENCY_SCAN_BYTES,
}) {
  const assets = new Map();
  const cssQueue = [];
  const scriptQueue = [];
  const pendingReferences = collectHtmlAssetReferences(html);

  const add = async ({ value, extensions, basePath = "" }) => {
    const relativePath = normalizeRelativeAssetPath(value, basePath);
    if (
      !relativePath
      || !isAllowedAssetType(relativePath, extensions)
      || assets.has(relativePath)
      || assets.size >= maxAssets
    ) return;
    const resolvedPath = await resolveDeclaredAsset(sourceRoot, relativePath);
    if (!resolvedPath) return;
    const asset = Object.freeze({ relativePath, resolvedPath });
    assets.set(relativePath, asset);
    const extension = extensionForAsset(relativePath);
    if (STYLE_EXTENSIONS.has(extension)) cssQueue.push(asset);
    if (SCRIPT_EXTENSIONS.has(extension)) scriptQueue.push(asset);
  };

  while (pendingReferences.length > 0) {
    await add(pendingReferences.shift());
  }

  for (let index = 0; index < cssQueue.length; index += 1) {
    const stylesheet = cssQueue[index];
    try {
      const info = await stat(stylesheet.resolvedPath);
      if (info.size > maxDependencyScanBytes) continue;
      const source = await readFile(stylesheet.resolvedPath, "utf8");
      const basePath = path.posix.dirname(stylesheet.relativePath);
      const references = cssReferences(source);
      for (const value of references.imports) {
        await add({ value, extensions: STYLE_EXTENSIONS, basePath });
      }
      for (const value of references.urls) {
        await add({ value, extensions: CSS_URL_EXTENSIONS, basePath });
      }
    } catch {
      // A missing or unreadable declared stylesheet simply cannot extend the
      // preview session's capability set.
    }
  }

  for (let index = 0; index < scriptQueue.length; index += 1) {
    const script = scriptQueue[index];
    try {
      const info = await stat(script.resolvedPath);
      if (info.size > maxDependencyScanBytes) continue;
      const source = await readFile(script.resolvedPath, "utf8");
      const basePath = path.posix.dirname(script.relativePath);
      for (const value of javaScriptImports(source)) {
        await add({ value, extensions: SCRIPT_EXTENSIONS, basePath });
      }
    } catch {
      // A missing or unreadable declared script cannot authorize additional
      // local files for the preview.
    }
  }

  return assets;
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? "").toLowerCase();
  return SESSION_ID_PATTERN.test(sessionId) ? sessionId : null;
}

export function registerPreviewProtocolScheme(protocolApi) {
  if (schemePrivilegesRegistered) return;
  protocolApi.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
  schemePrivilegesRegistered = true;
}

export function createPreviewSessionOperation({
  createSession,
  authorizeSourcePath,
} = {}) {
  if (typeof createSession !== "function") {
    throw new TypeError("Preview session operation requires createSession.");
  }
  if (typeof authorizeSourcePath !== "function") {
    throw new TypeError(
      "Preview session operation requires source path authorization.",
    );
  }
  return async (payload) => {
    const sourcePath = payload?.sourcePath === undefined
      || payload?.sourcePath === null
      || payload?.sourcePath === ""
      ? undefined
      : await authorizeSourcePath(payload.sourcePath);
    return createSession({
      html: payload?.html,
      bootstrapJavaScript: payload?.bootstrapJavaScript,
      ...(sourcePath ? { sourcePath } : {}),
    });
  };
}

export function createPreviewProtocolController({
  protocolApi,
  netFetch,
  now = () => Date.now(),
  randomSessionId = () => randomBytes(16).toString("hex"),
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
  maxBootstrapBytes = DEFAULT_MAX_BOOTSTRAP_BYTES,
  maxSessions = DEFAULT_MAX_SESSIONS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  if (!protocolApi || typeof protocolApi.handle !== "function") {
    throw new TypeError("Preview protocol controller requires protocol.handle.");
  }
  if (typeof netFetch !== "function") {
    throw new TypeError("Preview protocol controller requires Electron net.fetch.");
  }

  const sessions = new Map();
  let installed = false;

  const removeExpiredSessions = () => {
    const cutoff = now() - sessionTtlMs;
    for (const [sessionId, session] of sessions) {
      if (session.lastAccessedAt < cutoff) sessions.delete(sessionId);
    }
  };

  const createSession = async (payload) => {
    const html = typeof payload?.html === "string" ? payload.html : null;
    const bootstrapJavaScript = typeof payload?.bootstrapJavaScript === "string"
      ? payload.bootstrapJavaScript
      : null;
    if (
      html === null
      || bootstrapJavaScript === null
      || utf8ByteLength(html) > maxHtmlBytes
      || utf8ByteLength(bootstrapJavaScript) > maxBootstrapBytes
    ) {
      throw new TypeError("Interactive preview payload is invalid or too large.");
    }
    const sourceRoot = await resolveSourceRoot(payload?.sourcePath);
    const declaredAssets = sourceRoot
      ? await collectDeclaredAssets({ html, sourceRoot })
      : new Map();
    removeExpiredSessions();
    while (sessions.size >= maxSessions) {
      const oldestSessionId = sessions.keys().next().value;
      if (!oldestSessionId) break;
      sessions.delete(oldestSessionId);
    }

    let sessionId = null;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = normalizeSessionId(randomSessionId());
      if (candidate && !sessions.has(candidate)) {
        sessionId = candidate;
        break;
      }
    }
    if (!sessionId) throw new Error("Unable to allocate a preview session.");
    const createdAt = now();
    sessions.set(sessionId, {
      html,
      bootstrapJavaScript,
      sourceRoot,
      declaredAssets,
      createdAt,
      lastAccessedAt: createdAt,
    });
    return Object.freeze({
      sessionId,
      url: `${PREVIEW_PROTOCOL_SCHEME}://${sessionId}/index.html`,
    });
  };

  const revokeSession = (sessionIdInput) => {
    const sessionId = normalizeSessionId(sessionIdInput);
    return Object.freeze({
      revoked: sessionId ? sessions.delete(sessionId) : false,
    });
  };

  const handleRequest = async (request) => {
    if (!request || (request.method !== "GET" && request.method !== "HEAD")) {
      return invalidRequest();
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return invalidRequest();
    }
    const sessionId = normalizeSessionId(requestUrl.hostname);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return notFound();
    if (session.lastAccessedAt < now() - sessionTtlMs) {
      sessions.delete(sessionId);
      return notFound();
    }
    session.lastAccessedAt = now();

    if (requestUrl.pathname === "/index.html" || requestUrl.pathname === "/") {
      return response(
        request.method === "HEAD" ? null : session.html,
        200,
        "text/html; charset=utf-8",
        { "content-security-policy": PREVIEW_DOCUMENT_CSP },
      );
    }
    if (requestUrl.pathname === PREVIEW_BOOTSTRAP_PATH) {
      return response(
        request.method === "HEAD" ? null : session.bootstrapJavaScript,
        200,
        "text/javascript; charset=utf-8",
      );
    }
    if (!session.sourceRoot) return notFound();

    const relativePath = normalizeRelativeAssetPath(requestUrl.pathname);
    if (!relativePath) return invalidRequest();
    const asset = session.declaredAssets.get(relativePath);
    if (!asset) return notFound();

    try {
      const resolvedPath = await realpath(asset.resolvedPath);
      if (
        resolvedPath !== asset.resolvedPath
        || !isContainedPath(session.sourceRoot, resolvedPath)
      ) return notFound();
      const fileInfo = await stat(resolvedPath);
      if (!fileInfo.isFile()) return notFound();
      return netFetch(pathToFileURL(resolvedPath).href, {
        method: request.method,
        headers: request.headers,
      });
    } catch {
      return notFound();
    }
  };

  const install = () => {
    if (installed) return;
    protocolApi.handle(PREVIEW_PROTOCOL_SCHEME, handleRequest);
    installed = true;
  };

  const dispose = () => {
    sessions.clear();
  };

  return Object.freeze({
    install,
    createSession,
    revokeSession,
    dispose,
    sessionCount: () => sessions.size,
    handleRequest,
  });
}
