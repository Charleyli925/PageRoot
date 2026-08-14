import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
  hasEditRuntimeEchartsSignal,
  isEditRuntimeEchartsCandidate,
  isEditRuntimeExecutionId,
  isEditRuntimeSessionId,
  unsupportedEditRuntimeProgramReason,
} from "../app/domain/edit-runtime-contract.js";
import { createEditRuntimeBootstrap } from "./edit-runtime-bootstrap.mjs";
import {
  collectDeclaredPreviewAssets,
  normalizeRelativeAssetPath,
  resolvePreviewSourceRoot,
} from "./preview-protocol.mjs";

const AUTHOR_SCRIPT_PATH = /^\/.pageroot\/author\/(\d+)\.js$/u;
const BOOTSTRAP_PATH = /^\/.pageroot\/bootstrap\/([a-f0-9]{24})\.js$/u;
const RESERVED_ATTRIBUTE_PREFIX = "data-pageroot-edit-runtime-";
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);
const ALLOWED_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
]);

let schemePrivilegesRegistered = false;

function utf8Bytes(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function response(body, status, contentType) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
    },
  });
}

function notFound() {
  return response("Not found", 404, "text/plain; charset=utf-8");
}

function invalidRequest() {
  return response("Invalid Edit runtime request", 400, "text/plain; charset=utf-8");
}

function assetContentType(relativePath) {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    case ".ico": return "image/x-icon";
    case ".jpeg":
    case ".jpg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".otf": return "font/otf";
    case ".ttf": return "font/ttf";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".m4a": return "audio/mp4";
    case ".mp3": return "audio/mpeg";
    case ".mp4": return "video/mp4";
    case ".oga":
    case ".ogg": return "audio/ogg";
    case ".ogv": return "video/ogg";
    case ".wav": return "audio/wav";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => typeof child?.tagName === "string");
}

function documentElement(documentNode) {
  return elementChildren(documentNode).find((node) => (
    String(node.tagName || "").toLowerCase() === "html"
  )) || null;
}

function childAtPath(root, pathValue) {
  let current = root;
  for (const index of pathValue) {
    current = elementChildren(current)[index] || null;
    if (!current) return null;
  }
  return current;
}

function sourceContentIsEmpty(node) {
  return (node?.childNodes || []).every((child) => (
    child?.nodeName === "#comment"
    || (child?.nodeName === "#text" && !String(child.value || "").trim())
  ));
}

function attributesFor(node) {
  return new Map((node?.attrs || []).map((attribute) => [
    String(attribute.name || "").toLowerCase(),
    String(attribute.value || ""),
  ]));
}

function containsReservedRuntimeAttribute(node) {
  const visit = (current) => {
    if (!current || typeof current !== "object") return false;
    if ((current.attrs || []).some((attribute) => (
      String(attribute.name || "").toLowerCase().startsWith(RESERVED_ATTRIBUTE_PREFIX)
    ))) return true;
    return (current.childNodes || []).some(visit)
      || Boolean(current.content && visit(current.content));
  };
  return visit(node);
}

function validHostKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function validHostBinding(value, keys) {
  if (!isRecord(value) || keys.has(value.key) || !validHostKey(value.key)) return null;
  if (
    !Array.isArray(value.path)
    || value.path.length > 256
    || value.path.some((index) => (
      !Number.isSafeInteger(index) || index < 0 || index > 65_535
    ))
  ) return null;
  if (
    typeof value.tagName !== "string"
    || !/^[A-Za-z][A-Za-z0-9:-]{0,63}$/u.test(value.tagName)
  ) return null;
  if (!Array.isArray(value.identityAttributes) || !value.identityAttributes.length) return null;
  if (value.identityAttributes.length > 8) return null;
  const names = new Set();
  const attributes = [];
  for (const pair of value.identityAttributes) {
    if (
      !Array.isArray(pair)
      || pair.length !== 2
      || typeof pair[0] !== "string"
      || !/^[A-Za-z_:][A-Za-z0-9:_.-]{0,127}$/u.test(pair[0])
      || typeof pair[1] !== "string"
      || pair[1].length > 2_048
      || names.has(pair[0].toLowerCase())
    ) return null;
    names.add(pair[0].toLowerCase());
    attributes.push(Object.freeze([pair[0].toLowerCase(), pair[1]]));
  }
  keys.add(value.key);
  return Object.freeze({
    key: value.key,
    path: Object.freeze([...value.path]),
    tagName: value.tagName.toLowerCase(),
    identityAttributes: Object.freeze(attributes),
  });
}

export function validateEditRuntimeHostBindings(value) {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > EDIT_AUTHOR_RUNTIME_BUDGET.hostCount
  ) throw new TypeError("Edit runtime host bindings are invalid.");
  const keys = new Set();
  const bindings = value.map((item) => validHostBinding(item, keys));
  if (bindings.some((binding) => binding === null)) {
    throw new TypeError("Edit runtime host bindings are invalid.");
  }
  return Object.freeze(bindings);
}

function validateBoundHosts(documentNode, bindings) {
  if (containsReservedRuntimeAttribute(documentNode)) {
    throw new TypeError("Edit runtime source reserves a PageRoot runtime attribute.");
  }
  const root = documentElement(documentNode);
  if (!root) throw new TypeError("Edit runtime source has no document root.");
  for (const binding of bindings) {
    const element = childAtPath(root, binding.path);
    if (
      !element
      || String(element.tagName || "").toLowerCase() !== binding.tagName
      || !sourceContentIsEmpty(element)
    ) throw new TypeError("Edit runtime host binding is not source-empty.");
    const attributes = attributesFor(element);
    if (!binding.identityAttributes.every(([name, expected]) => (
      attributes.get(name) === expected
    ))) throw new TypeError("Edit runtime host binding is not exact.");
  }
}

function containedPath(rootPath, candidate) {
  const relative = path.relative(rootPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveLocalScript(sourceRoot, reference, {
  readFileImpl,
  realpathImpl,
  statImpl,
}) {
  const relative = normalizeRelativeAssetPath(reference);
  if (!relative || !SCRIPT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
    throw new TypeError("Edit runtime local script is not allowed.");
  }
  const candidate = path.resolve(sourceRoot, ...relative.split("/"));
  if (!containedPath(sourceRoot, candidate)) {
    throw new TypeError("Edit runtime local script escapes its source directory.");
  }
  const resolved = await realpathImpl(candidate);
  if (!containedPath(sourceRoot, resolved)) {
    throw new TypeError("Edit runtime local script escapes its source directory.");
  }
  const information = await statImpl(resolved);
  if (!information.isFile() || information.size > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
    throw new TypeError("Edit runtime local script is too large or invalid.");
  }
  const bytes = Buffer.from(await readFileImpl(resolved));
  if (bytes.byteLength < 1 || bytes.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
    throw new TypeError("Edit runtime local script is too large or empty.");
  }
  return bytes;
}

function permittedEchartsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    return url.protocol === "https:"
      && ALLOWED_CDN_HOSTS.has(host)
      && pathname.includes("echarts")
      && /\.m?js$/u.test(pathname);
  } catch {
    return false;
  }
}

async function fetchFixedEchartsBytes(initialUrl, netFetch) {
  let url = String(initialUrl);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!permittedEchartsUrl(url)) {
      throw new TypeError("Edit runtime remote script is not an allowed ECharts CDN URL.");
    }
    const responseValue = await netFetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
    });
    const status = Number(responseValue?.status || 0);
    if (status >= 300 && status < 400) {
      const next = responseValue.headers?.get?.("location");
      if (!next) throw new TypeError("Edit runtime CDN redirect is invalid.");
      url = new URL(next, url).href;
      continue;
    }
    if (!responseValue?.ok) throw new TypeError("Edit runtime CDN script could not be loaded.");
    const declaredLength = Number(responseValue.headers?.get?.("content-length") || 0);
    if (declaredLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
      throw new TypeError("Edit runtime CDN script is too large.");
    }
    const bytes = Buffer.from(await responseValue.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
      throw new TypeError("Edit runtime CDN script is too large or empty.");
    }
    return bytes;
  }
  throw new TypeError("Edit runtime CDN redirect limit exceeded.");
}

async function fixedAuthorScripts({
  html,
  sourceRoot,
  netFetch,
  readFileImpl,
  realpathImpl,
  statImpl,
}) {
  const contract = collectEditRuntimeScripts(html);
  if (contract.unsupportedReason) {
    throw new TypeError("Edit runtime script is unsupported: " + contract.unsupportedReason + ".");
  }
  if (
    contract.executableScripts.length < 1
    || contract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
  ) throw new TypeError("Edit runtime script count is invalid.");
  const scripts = [];
  let totalBytes = 0;
  let containsEchartsSignal = isEditRuntimeEchartsCandidate(html);
  for (const descriptor of contract.executableScripts) {
    const bytes = descriptor.src
      ? (permittedEchartsUrl(descriptor.src)
        ? await fetchFixedEchartsBytes(descriptor.src, netFetch)
        : await resolveLocalScript(sourceRoot, descriptor.src, {
            readFileImpl,
            realpathImpl,
            statImpl,
          }))
      : Buffer.from(descriptor.inline, "utf8");
    if (bytes.byteLength < 1 || bytes.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
      throw new TypeError("Edit runtime script exceeds the byte budget.");
    }
    const program = bytes.toString("utf8");
    const programReason = unsupportedEditRuntimeProgramReason(program);
    if (programReason) {
      throw new TypeError("Edit runtime script is unsupported: " + programReason + ".");
    }
    containsEchartsSignal ||= hasEditRuntimeEchartsSignal(program);
    totalBytes += bytes.byteLength;
    if (totalBytes > EDIT_AUTHOR_RUNTIME_BUDGET.aggregateScriptBytes) {
      throw new TypeError("Edit runtime script aggregate exceeds the byte budget.");
    }
    scripts.push(Object.freeze({
      index: descriptor.index,
      bytes,
      sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      available: true,
    }));
  }
  if (!containsEchartsSignal) {
    throw new TypeError("Edit runtime requires an ECharts candidate source.");
  }
  const digest = createHash("sha256");
  for (const script of scripts) {
    digest.update(String(script.index));
    digest.update("\0");
    digest.update(script.bytes);
    digest.update("\0");
  }
  return Object.freeze({
    scripts: Object.freeze(scripts),
    byteLength: totalBytes,
    resourceSha256: "sha256:" + digest.digest("hex"),
  });
}

function sessionIdFrom(value) {
  const normalized = String(value || "").toLowerCase();
  return isEditRuntimeSessionId(normalized) ? normalized : null;
}

function executionIdFrom(value) {
  const normalized = String(value || "").toLowerCase();
  return isEditRuntimeExecutionId(normalized) ? normalized : null;
}

export function registerEditRuntimeProtocolScheme(protocolApi) {
  if (schemePrivilegesRegistered) return;
  protocolApi.registerSchemesAsPrivileged([
    {
      scheme: EDIT_RUNTIME_PROTOCOL_SCHEME,
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

/**
 * One immutable resource session per execution. It has no compatibility
 * result, promotion document, LRU, TTL cache, or second execution identity.
 * A short orphan cleanup only bounds abandoned sessions after navigation.
 */
export function createEditRuntimeProtocolController({
  protocolApi,
  netFetch,
  now = () => Date.now(),
  randomSessionId = () => randomBytes(16).toString("hex"),
  randomExecutionId = () => randomBytes(12).toString("hex"),
  readFileImpl = readFile,
  realpathImpl = realpath,
  statImpl = stat,
  orphanSessionTtlMs = EDIT_AUTHOR_RUNTIME_BUDGET.orphanSessionTtlMs,
} = {}) {
  if (!protocolApi || typeof protocolApi.handle !== "function") {
    throw new TypeError("Edit runtime protocol requires protocol.handle.");
  }
  if (typeof netFetch !== "function") {
    throw new TypeError("Edit runtime protocol requires Electron net.fetch.");
  }
  const sessions = new Map();
  const installedProtocols = new WeakSet();
  const allocate = (create, predicate) => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const value = String(create() || "").toLowerCase();
      if (predicate(value)) return value;
    }
    throw new Error("Unable to allocate an Edit runtime identity.");
  };
  const pruneOrphans = () => {
    const cutoff = now() - Math.max(1, Number(orphanSessionTtlMs) || 1);
    for (const [id, session] of sessions) {
      if (session.createdAt < cutoff) sessions.delete(id);
    }
  };
  const createSession = async ({ html, sourcePath, bindings } = {}) => {
    const source = typeof html === "string" ? html : null;
    if (!source || utf8Bytes(source) > EDIT_AUTHOR_RUNTIME_BUDGET.htmlBytes) {
      throw new TypeError("Edit runtime source is invalid or too large.");
    }
    const normalizedBindings = validateEditRuntimeHostBindings(bindings);
    const documentNode = parse(source);
    validateBoundHosts(documentNode, normalizedBindings);
    const sourceRoot = await resolvePreviewSourceRoot(sourcePath);
    if (!sourceRoot) throw new TypeError("Edit runtime requires a known local source path.");
    const frozenScripts = await fixedAuthorScripts({
      html: source,
      sourceRoot,
      netFetch,
      readFileImpl,
      realpathImpl,
      statImpl,
    });
    const declaredAssets = await collectDeclaredPreviewAssets({
      html: source,
      sourceRoot,
    });
    pruneOrphans();
    const sessionId = allocate(randomSessionId, (candidate) => (
      isEditRuntimeSessionId(candidate) && !sessions.has(candidate)
    ));
    const executionId = allocate(randomExecutionId, isEditRuntimeExecutionId);
    const createdAt = now();
    sessions.set(sessionId, {
      sessionId,
      executionId,
      sourceRoot,
      declaredAssets,
      scripts: frozenScripts.scripts.map((script) => ({ ...script })),
      byteLength: frozenScripts.byteLength,
      resourceSha256: frozenScripts.resourceSha256,
      bindings: normalizedBindings,
      bootstrapAvailable: true,
      createdAt,
    });
    return Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      sessionId,
      executionId,
      scriptCount: frozenScripts.scripts.length,
      resourceSha256: frozenScripts.resourceSha256,
      byteLength: frozenScripts.byteLength,
      bindings: normalizedBindings,
    });
  };
  const revokeSession = (value) => {
    const sessionId = sessionIdFrom(value);
    return Object.freeze({ revoked: sessionId ? sessions.delete(sessionId) : false });
  };
  const handleRequest = async (request) => {
    if (!request || (request.method !== "GET" && request.method !== "HEAD")) return invalidRequest();
    let requestUrl;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return invalidRequest();
    }
    pruneOrphans();
    const sessionId = sessionIdFrom(requestUrl.hostname);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return notFound();
    const bootstrap = requestUrl.pathname.match(BOOTSTRAP_PATH);
    if (bootstrap) {
      if (
        executionIdFrom(bootstrap[1]) !== session.executionId
        || (request.method === "GET" && !session.bootstrapAvailable)
      ) return notFound();
      if (request.method === "GET") session.bootstrapAvailable = false;
      return response(
        request.method === "HEAD" ? null : createEditRuntimeBootstrap({
          executionId: session.executionId,
          sessionId: session.sessionId,
        }),
        200,
        "text/javascript; charset=utf-8",
      );
    }
    const authorScript = requestUrl.pathname.match(AUTHOR_SCRIPT_PATH);
    if (authorScript) {
      const index = Number(authorScript[1]);
      const script = session.scripts[index];
      if (
        !Number.isSafeInteger(index)
        || !script
        || script.index !== index
        || (request.method === "GET" && !script.available)
      ) return notFound();
      if (request.method === "GET") script.available = false;
      return response(
        request.method === "HEAD" ? null : script.bytes,
        200,
        "text/javascript; charset=utf-8",
      );
    }
    const relative = normalizeRelativeAssetPath(requestUrl.pathname);
    if (!relative || SCRIPT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
      return notFound();
    }
    const asset = session.declaredAssets.get(relative);
    if (!asset) return notFound();
    try {
      const resolved = await realpathImpl(asset.resolvedPath);
      if (resolved !== asset.resolvedPath || !containedPath(session.sourceRoot, resolved)) {
        return notFound();
      }
      const information = await statImpl(resolved);
      if (!information.isFile()) return notFound();
      const bytes = await readFileImpl(resolved);
      return response(
        request.method === "HEAD" ? null : bytes,
        200,
        assetContentType(relative),
      );
    } catch {
      return notFound();
    }
  };
  const installFor = (targetProtocol = protocolApi) => {
    if (!targetProtocol || typeof targetProtocol.handle !== "function") {
      throw new TypeError("Edit runtime protocol target requires handle().");
    }
    if (installedProtocols.has(targetProtocol)) return;
    targetProtocol.handle(EDIT_RUNTIME_PROTOCOL_SCHEME, handleRequest);
    installedProtocols.add(targetProtocol);
  };
  return Object.freeze({
    install: () => installFor(protocolApi),
    installFor,
    createSession,
    revokeSession,
    dispose: () => sessions.clear(),
    sessionCount: () => sessions.size,
    handleRequest,
  });
}

export function editRuntimeBootstrapUrl(sessionId, executionId) {
  if (!isEditRuntimeSessionId(sessionId) || !isEditRuntimeExecutionId(executionId)) {
    return null;
  }
  return editRuntimeProtocolUrl(
    sessionId,
    "/.pageroot/bootstrap/" + String(executionId).toLowerCase() + ".js",
  );
}
