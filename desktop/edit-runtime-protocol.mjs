import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parse, parseFragment, serialize } from "parse5";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
  EDIT_RUNTIME_OWNED_ATTRIBUTE,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
  editRuntimeSourceMarker,
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
const PROBE_DOCUMENT_PATH = "/.pageroot/probe/index.html";
const RESERVED_ATTRIBUTE_PREFIX = "data-pageroot-edit-runtime-";
const CANVAS_SOURCE_ATTRIBUTE = "data-html-ai-source-node-id";
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

function response(body, status, contentType, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function notFound() {
  return response("Not found", 404, "text/plain; charset=utf-8");
}

function invalidRequest() {
  return response("Invalid Edit runtime request", 400, "text/plain; charset=utf-8");
}

function sourceDocumentCsp() {
  return [
    "default-src 'self' pageroot-edit-runtime: data:",
    "script-src pageroot-edit-runtime:",
    "style-src 'self' pageroot-edit-runtime: 'unsafe-inline'",
    "img-src 'self' pageroot-edit-runtime: data:",
    "font-src 'self' pageroot-edit-runtime: data:",
    "media-src 'none'",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

function attributesFor(node) {
  return new Map((node?.attrs || []).map((attribute) => [
    String(attribute.name || "").toLowerCase(),
    String(attribute.value || ""),
  ]));
}

function setAttribute(node, name, value) {
  const normalized = String(name).toLowerCase();
  node.attrs ||= [];
  node.attrs = node.attrs.filter((attribute) => (
    String(attribute.name || "").toLowerCase() !== normalized
  ));
  node.attrs.push({ name: normalized, value: String(value) });
}

function removeAttribute(node, name) {
  const normalized = String(name).toLowerCase();
  node.attrs = (node.attrs || []).filter((attribute) => (
    String(attribute.name || "").toLowerCase() !== normalized
  ));
}

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => typeof child?.tagName === "string");
}

function allElements(root) {
  const elements = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.tagName === "string") elements.push(node);
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(root);
  return elements;
}

function documentElement(documentNode) {
  return elementChildren(documentNode).find((node) => (
    String(node.tagName).toLowerCase() === "html"
  )) || null;
}

function directChild(root, tagName) {
  return elementChildren(root).find((node) => (
    String(node.tagName).toLowerCase() === tagName
  )) || null;
}

function browserPathMap(documentNode) {
  const root = documentElement(documentNode);
  if (!root) return null;
  const paths = new Map();
  const visit = (element, pathValue) => {
    paths.set(element, pathValue);
    elementChildren(element).forEach((child, index) => {
      visit(child, [...pathValue, index]);
    });
  };
  visit(root, []);
  return paths;
}

function sourceNodeIdFor(element) {
  const location = element?.sourceCodeLocation;
  const start = Number(location?.startTag?.startOffset);
  const end = Number(location?.endOffset);
  const tagName = String(element?.tagName || "").toLowerCase();
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !tagName) return null;
  return `element:${start}:${end}:${tagName}`;
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validHostKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function validHostBinding(value, keys) {
  if (!isRecord(value) || keys.has(value.key) || !validHostKey(value.key)) return null;
  if (
    !Array.isArray(value.path)
    || value.path.length > 256
    || value.path.some((index) => !Number.isSafeInteger(index) || index < 0 || index > 65_535)
  ) return null;
  if (typeof value.tagName !== "string" || !/^[A-Za-z][A-Za-z0-9:-]{0,63}$/u.test(value.tagName)) {
    return null;
  }
  if (!Array.isArray(value.identityAttributes) || value.identityAttributes.length > 8) return null;
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
  if (!attributes.length) return null;
  keys.add(value.key);
  return Object.freeze({
    key: value.key,
    path: Object.freeze([...value.path]),
    tagName: value.tagName.toLowerCase(),
    identityAttributes: Object.freeze(attributes),
  });
}

export function validateEditRuntimeHostBindings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > EDIT_AUTHOR_RUNTIME_BUDGET.hostCount) {
    throw new TypeError("Edit runtime host bindings are invalid.");
  }
  const keys = new Set();
  const bindings = value.map((item) => validHostBinding(item, keys));
  if (bindings.some((binding) => binding === null)) {
    throw new TypeError("Edit runtime host bindings are invalid.");
  }
  return Object.freeze(bindings);
}

function validateBoundHosts(documentNode, bindings) {
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

function containsReservedRuntimeAttribute(documentNode) {
  return allElements(documentNode).some((element) => (
    (element.attrs || []).some((attribute) => (
      String(attribute.name || "").toLowerCase().startsWith(RESERVED_ATTRIBUTE_PREFIX)
    ))
  ));
}

function scriptNodes(documentNode) {
  return allElements(documentNode).filter((element) => (
    String(element.tagName || "").toLowerCase() === "script"
  ));
}

function bootstrapNode(url) {
  const fragment = parseFragment(
    `<script src="${url}" ${EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE}="true" ${EDIT_RUNTIME_OWNED_ATTRIBUTE}="bootstrap"></script>`,
  );
  return fragment.childNodes.find((node) => String(node?.tagName || "").toLowerCase() === "script") || null;
}

function probeBaseNode(url) {
  const fragment = parseFragment(
    `<base href="${url}" ${EDIT_RUNTIME_OWNED_ATTRIBUTE}="probe-base">`,
  );
  return fragment.childNodes.find((node) => String(node?.tagName || "").toLowerCase() === "base") || null;
}

/**
 * The desktop owner builds both documents from the same parsed source. The
 * probe gets a contained protocol base; the renderer gets a srcdoc document
 * and retains its established local base/resource behavior. Both carry the
 * same source marker paths and fixed script stubs.
 */
export function prepareEditRuntimeDocument({
  html,
  sessionId,
  executionId,
  bindings,
  probe = false,
} = {}) {
  if (!isEditRuntimeSessionId(sessionId) || !isEditRuntimeExecutionId(executionId)) {
    throw new TypeError("Edit runtime document identity is invalid.");
  }
  const source = String(html || "");
  const scriptContract = collectEditRuntimeScripts(source);
  if (scriptContract.unsupportedReason) {
    throw new TypeError(`Edit runtime script is unsupported: ${scriptContract.unsupportedReason}.`);
  }
  if (!isEditRuntimeEchartsCandidate(source)) {
    throw new TypeError("Edit runtime requires an ECharts candidate source.");
  }
  if (
    scriptContract.executableScripts.length < 1
    || scriptContract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
  ) throw new TypeError("Edit runtime script count is invalid.");
  const documentNode = parse(source);
  if (containsReservedRuntimeAttribute(documentNode)) {
    throw new TypeError("Edit runtime source reserves a PageRoot runtime attribute.");
  }
  const normalizedBindings = validateEditRuntimeHostBindings(bindings);
  validateBoundHosts(documentNode, normalizedBindings);
  const root = documentElement(documentNode);
  const paths = browserPathMap(documentNode);
  if (!root || !paths || paths.size > EDIT_AUTHOR_RUNTIME_BUDGET.sourceNodeCount) {
    throw new TypeError("Edit runtime source structure is invalid.");
  }
  const hostByMarker = new Map(normalizedBindings.map((binding) => [
    editRuntimeSourceMarker(binding.path), binding.key,
  ]));
  for (const [element, pathValue] of paths) {
    const marker = editRuntimeSourceMarker(pathValue);
    if (!marker) throw new TypeError("Edit runtime source marker is invalid.");
    setAttribute(element, EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, marker);
    const sourceNodeId = sourceNodeIdFor(element);
    if (sourceNodeId) setAttribute(element, CANVAS_SOURCE_ATTRIBUTE, sourceNodeId);
    const hostKey = hostByMarker.get(marker);
    if (hostKey) setAttribute(element, EDIT_RUNTIME_HOST_ATTRIBUTE, hostKey);
  }
  const parsedScripts = scriptNodes(documentNode);
  if (parsedScripts.length !== scriptContract.scripts.length) {
    throw new TypeError("Edit runtime script parsing is inconsistent.");
  }
  parsedScripts.forEach((node, ordinal) => {
    const descriptor = scriptContract.scripts[ordinal];
    if (!descriptor?.executable) return;
    removeAttribute(node, "src");
    removeAttribute(node, "async");
    removeAttribute(node, "defer");
    removeAttribute(node, "nomodule");
    setAttribute(node, "type", "application/x-pageroot-edit-runtime-source");
    setAttribute(node, EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE, descriptor.index);
    node.childNodes = [];
  });
  const head = directChild(root, "head") || root;
  if (probe) {
    for (const element of allElements(documentNode)) {
      if (String(element.tagName || "").toLowerCase() === "base") {
        setAttribute(element, "href", editRuntimeProtocolUrl(sessionId, "/") || "");
      }
    }
    if (!allElements(documentNode).some((element) => (
      String(element.tagName || "").toLowerCase() === "base"
    ))) {
      const base = probeBaseNode(editRuntimeProtocolUrl(sessionId, "/") || "");
      if (base) head.childNodes.unshift(base);
    }
  }
  const bootstrap = bootstrapNode(
    editRuntimeProtocolUrl(sessionId, `/.pageroot/bootstrap/${executionId}.js`) || "",
  );
  if (!bootstrap) throw new TypeError("Edit runtime bootstrap could not be prepared.");
  head.childNodes.unshift(bootstrap);
  return Object.freeze({
    html: serialize(documentNode),
    bindings: normalizedBindings,
    scriptCount: scriptContract.executableScripts.length,
  });
}

function containedPath(rootPath, candidate) {
  const relative = path.relative(rootPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveLocalScript(sourceRoot, reference, {
  readFileImpl,
  realpathImpl,
  statImpl,
} = {}) {
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
  if (bytes.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
    throw new TypeError("Edit runtime local script is too large.");
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
    throw new TypeError(`Edit runtime script is unsupported: ${contract.unsupportedReason}.`);
  }
  if (
    contract.executableScripts.length < 1
    || contract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
  ) throw new TypeError("Edit runtime script count is invalid.");
  const scripts = [];
  let totalBytes = 0;
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
    const programReason = unsupportedEditRuntimeProgramReason(bytes.toString("utf8"));
    if (programReason) {
      throw new TypeError(`Edit runtime script is unsupported: ${programReason}.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > EDIT_AUTHOR_RUNTIME_BUDGET.aggregateScriptBytes) {
      throw new TypeError("Edit runtime script aggregate exceeds the byte budget.");
    }
    scripts.push(Object.freeze({
      index: descriptor.index,
      bytes,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    }));
  }
  const digest = createHash("sha256");
  scripts.forEach((script) => {
    digest.update(String(script.index));
    digest.update("\0");
    digest.update(script.bytes);
    digest.update("\0");
  });
  return Object.freeze({
    scripts: Object.freeze(scripts),
    byteLength: totalBytes,
    resourceSha256: `sha256:${digest.digest("hex")}`,
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
 * Main-process storage for one source-bound set of author script bytes. Probe
 * and direct Edit receive separate one-use bootstraps but the identical immutable
 * resource array; no raw network URL remains executable in the Edit frame.
 */
export function createEditRuntimeProtocolController({
  protocolApi,
  netFetch,
  now = () => Date.now(),
  randomSessionId = () => randomBytes(16).toString("hex"),
  randomExecutionId = () => randomBytes(12).toString("hex"),
  randomFreezeKey = () => `__pagerootEditRuntime_${randomBytes(18).toString("hex")}`,
  readFileImpl = readFile,
  realpathImpl = realpath,
  statImpl = stat,
  maxSessions = EDIT_AUTHOR_RUNTIME_BUDGET.cacheEntries,
  sessionTtlMs = EDIT_AUTHOR_RUNTIME_BUDGET.cacheTtlMs,
} = {}) {
  if (!protocolApi || typeof protocolApi.handle !== "function") {
    throw new TypeError("Edit runtime protocol requires protocol.handle.");
  }
  if (typeof netFetch !== "function") {
    throw new TypeError("Edit runtime protocol requires Electron net.fetch.");
  }
  const sessions = new Map();
  const installedProtocols = new WeakSet();
  const removeExpired = () => {
    const cutoff = now() - sessionTtlMs;
    for (const [id, session] of sessions) {
      if (session.lastAccessedAt < cutoff) sessions.delete(id);
    }
  };
  const allocate = (create, predicate) => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const value = String(create() || "").toLowerCase();
      if (predicate(value)) return value;
    }
    throw new Error("Unable to allocate an Edit runtime identity.");
  };
  const createSession = async ({ html, sourcePath, bindings }) => {
    const source = typeof html === "string" ? html : null;
    if (!source || utf8Bytes(source) > EDIT_AUTHOR_RUNTIME_BUDGET.htmlBytes) {
      throw new TypeError("Edit runtime source is invalid or too large.");
    }
    const normalizedBindings = validateEditRuntimeHostBindings(bindings);
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
    if (!isEditRuntimeEchartsCandidate(source)) {
      throw new TypeError("Edit runtime requires an ECharts candidate source.");
    }
    const declaredAssets = await collectDeclaredPreviewAssets({
      html: source,
      sourceRoot,
    });
    removeExpired();
    while (sessions.size >= Math.max(1, maxSessions)) {
      const oldest = sessions.keys().next().value;
      if (!oldest) break;
      sessions.delete(oldest);
    }
    const sessionId = allocate(randomSessionId, (candidate) => (
      isEditRuntimeSessionId(candidate) && !sessions.has(candidate)
    ));
    const probeExecutionId = allocate(randomExecutionId, isEditRuntimeExecutionId);
    let directExecutionId = allocate(randomExecutionId, isEditRuntimeExecutionId);
    while (directExecutionId === probeExecutionId) directExecutionId = allocate(randomExecutionId, isEditRuntimeExecutionId);
    const executions = new Map([
      [probeExecutionId, {
        id: probeExecutionId,
        freezeKey: String(randomFreezeKey()),
        bootstrapPrivateAvailable: true,
      }],
      [directExecutionId, {
        id: directExecutionId,
        freezeKey: String(randomFreezeKey()),
        bootstrapPrivateAvailable: true,
      }],
    ]);
    for (const execution of executions.values()) {
      if (execution.freezeKey.length < 16) {
        throw new TypeError("Edit runtime private bootstrap key is invalid.");
      }
    }
    const probeDocument = prepareEditRuntimeDocument({
      html: source,
      sessionId,
      executionId: probeExecutionId,
      bindings: normalizedBindings,
      probe: true,
    });
    const createdAt = now();
    const session = {
      sessionId,
      sourceRoot,
      declaredAssets,
      scripts: frozenScripts.scripts,
      byteLength: frozenScripts.byteLength,
      resourceSha256: frozenScripts.resourceSha256,
      bindings: normalizedBindings,
      executions,
      probeHtml: probeDocument.html,
      probeUrl: editRuntimeProtocolUrl(sessionId, PROBE_DOCUMENT_PATH),
      createdAt,
      lastAccessedAt: createdAt,
    };
    sessions.set(sessionId, session);
    return Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      sessionId,
      probeExecutionId,
      directExecutionId,
      probeUrl: editRuntimeProtocolUrl(sessionId, PROBE_DOCUMENT_PATH),
      scriptCount: frozenScripts.scripts.length,
      resourceSha256: frozenScripts.resourceSha256,
      byteLength: frozenScripts.byteLength,
    });
  };
  const revokeSession = (value) => {
    const sessionId = sessionIdFrom(value);
    return Object.freeze({ revoked: sessionId ? sessions.delete(sessionId) : false });
  };
  const bootstrapSource = (session, execution) => createEditRuntimeBootstrap({
    freezeKey: execution.freezeKey,
    executionId: execution.id,
    sessionId: session.sessionId,
  });
  const handleRequest = async (request) => {
    if (!request || (request.method !== "GET" && request.method !== "HEAD")) return invalidRequest();
    let requestUrl;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return invalidRequest();
    }
    const sessionId = sessionIdFrom(requestUrl.hostname);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return notFound();
    if (session.lastAccessedAt < now() - sessionTtlMs) {
      sessions.delete(sessionId);
      return notFound();
    }
    session.lastAccessedAt = now();
    if (requestUrl.pathname === PROBE_DOCUMENT_PATH) {
      return response(
        request.method === "HEAD" ? null : session.probeHtml,
        200,
        "text/html; charset=utf-8",
        { "content-security-policy": sourceDocumentCsp() },
      );
    }
    const bootstrap = requestUrl.pathname.match(BOOTSTRAP_PATH);
    if (bootstrap) {
      const execution = session.executions.get(executionIdFrom(bootstrap[1]));
      if (!execution) return notFound();
      const privateBootstrap = request.method === "GET" && execution.bootstrapPrivateAvailable;
      if (privateBootstrap) execution.bootstrapPrivateAvailable = false;
      return response(
        request.method === "HEAD" ? null : privateBootstrap
          ? bootstrapSource(session, execution)
          : "void 0;",
        200,
        "text/javascript; charset=utf-8",
      );
    }
    const authorScript = requestUrl.pathname.match(AUTHOR_SCRIPT_PATH);
    if (authorScript) {
      const index = Number(authorScript[1]);
      const script = session.scripts[index];
      if (!Number.isSafeInteger(index) || !script || script.index !== index) return notFound();
      return response(
        request.method === "HEAD" ? null : script.bytes,
        200,
        "text/javascript; charset=utf-8",
      );
    }
    const relative = normalizeRelativeAssetPath(requestUrl.pathname);
    if (!relative || SCRIPT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) return notFound();
    const asset = session.declaredAssets.get(relative);
    if (!asset) return notFound();
    try {
      const resolved = await realpathImpl(asset.resolvedPath);
      if (resolved !== asset.resolvedPath || !containedPath(session.sourceRoot, resolved)) return notFound();
      const information = await statImpl(resolved);
      if (!information.isFile()) return notFound();
      const bytes = await readFileImpl(resolved);
      return response(
        request.method === "HEAD" ? null : bytes,
        200,
        "application/octet-stream",
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
