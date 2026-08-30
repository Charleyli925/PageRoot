import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
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
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);
const ALLOWED_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
]);
const BUNDLED_ECHARTS_VERSION = "5.5.0";
const BUNDLED_ECHARTS_SHA256 =
  "42f8329d989b6f6539dd2b15bbdf0d82025762ac112fbb60dc57b27d7bcf3946";

let schemePrivilegesRegistered = false;

function utf8Bytes(value) {
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
  return response("Invalid Edit runtime request", 400, "text/plain; charset=utf-8");
}

function assetContentType(relativePath) {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".css": return "text/css; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
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

function isBundledEchartsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const pathName = url.pathname.toLowerCase();
    return (
      (url.hostname === "cdnjs.cloudflare.com"
        && pathName === `/ajax/libs/echarts/${BUNDLED_ECHARTS_VERSION}/echarts.min.js`)
      || (url.hostname === "cdn.jsdelivr.net"
        && pathName === `/npm/echarts@${BUNDLED_ECHARTS_VERSION}/dist/echarts.min.js`)
      || (url.hostname === "unpkg.com"
        && pathName === `/echarts@${BUNDLED_ECHARTS_VERSION}/dist/echarts.min.js`)
    );
  } catch {
    return false;
  }
}

// Edit may resolve the reviewed ECharts CDN URLs to pinned packaged bytes.
// Review is static-only and has no author-runtime path.
export { permittedEchartsUrl };

function remoteScriptTimeoutError() {
  return new TypeError("Edit runtime CDN script timed out.");
}

function runtimePreparationTimeoutError() {
  return new TypeError("Edit runtime preparation timed out.");
}

async function settleWithinRuntimeDeadline(
  operation,
  controller,
  deadlineAt,
  timeoutError,
) {
  const remainingMs = Math.ceil(deadlineAt - Date.now());
  if (remainingMs <= 0) {
    controller.abort();
    throw timeoutError();
  }
  let timeout = null;
  const expiry = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, remainingMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      expiry,
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

async function readFixedEchartsBytes(responseValue, controller, deadlineAt) {
  const reader = responseValue?.body?.getReader?.();
  if (!reader) throw new TypeError("Edit runtime CDN script body is unavailable.");
  const chunks = [];
  let byteLength = 0;
  let complete = false;
  try {
    while (true) {
      const next = await settleWithinRuntimeDeadline(
        () => reader.read(),
        controller,
        deadlineAt,
        remoteScriptTimeoutError,
      );
      if (next.done) {
        complete = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      byteLength += chunk.byteLength;
      if (byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
        controller.abort();
        throw new TypeError("Edit runtime CDN script is too large.");
      }
      chunks.push(chunk);
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (byteLength < 1) throw new TypeError("Edit runtime CDN script is too large or empty.");
  return Buffer.concat(chunks, byteLength);
}

async function fetchFixedEchartsBytes(initialUrl, netFetch, deadlineAt, preparationSignal) {
  let url = String(initialUrl);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!permittedEchartsUrl(url)) {
      throw new TypeError("Edit runtime remote script is not an allowed ECharts CDN URL.");
    }
    const controller = new AbortController();
    const abortForPreparation = () => controller.abort();
    if (preparationSignal?.aborted) {
      controller.abort();
    } else {
      preparationSignal?.addEventListener("abort", abortForPreparation, { once: true });
    }
    try {
      const responseValue = await settleWithinRuntimeDeadline(
        () => netFetch(url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
        }),
        controller,
        deadlineAt,
        remoteScriptTimeoutError,
      );
      const status = Number(responseValue?.status || 0);
      if (status >= 300 && status < 400) {
        const next = responseValue.headers?.get?.("location");
        if (!next) throw new TypeError("Edit runtime CDN redirect is invalid.");
        controller.abort();
        url = new URL(next, url).href;
        continue;
      }
      if (!responseValue?.ok) throw new TypeError("Edit runtime CDN script could not be loaded.");
      const declaredLength = Number(responseValue.headers?.get?.("content-length") || 0);
      if (declaredLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
        controller.abort();
        throw new TypeError("Edit runtime CDN script is too large.");
      }
      return await readFixedEchartsBytes(responseValue, controller, deadlineAt);
    } finally {
      preparationSignal?.removeEventListener("abort", abortForPreparation);
    }
  }
  throw new TypeError("Edit runtime CDN redirect limit exceeded.");
}

export { fetchFixedEchartsBytes };

async function fixedAuthorScripts({
  html,
  sourceRoot,
  netFetch,
  readFileImpl,
  realpathImpl,
  statImpl,
  preparationDeadlineAt,
  preparationSignal,
  bundledEchartsPath,
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
  for (const descriptor of contract.executableScripts) {
    let libraryOrigin = descriptor.src ? "local" : "inline";
    let bytes;
    if (descriptor.src && permittedEchartsUrl(descriptor.src)) {
      const fetchRemote = () => fetchFixedEchartsBytes(
        descriptor.src,
        netFetch,
        preparationDeadlineAt,
        preparationSignal,
      );
      if (bundledEchartsPath && isBundledEchartsUrl(descriptor.src)) {
        bytes = Buffer.from(await readFileImpl(bundledEchartsPath));
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== BUNDLED_ECHARTS_SHA256) {
          throw new TypeError("Bundled ECharts bytes failed integrity verification.");
        }
        libraryOrigin = "bundled";
      } else {
        bytes = await fetchRemote();
        libraryOrigin = "network";
      }
    } else if (descriptor.src) {
      bytes = await resolveLocalScript(sourceRoot, descriptor.src, {
        readFileImpl,
        realpathImpl,
        statImpl,
      });
    } else {
      bytes = Buffer.from(descriptor.inline, "utf8");
    }
    if (bytes.byteLength < 1 || bytes.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
      throw new TypeError("Edit runtime script exceeds the byte budget.");
    }
    const program = bytes.toString("utf8");
    const programReason = unsupportedEditRuntimeProgramReason(program);
    if (programReason) {
      throw new TypeError("Edit runtime script is unsupported: " + programReason + ".");
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > EDIT_AUTHOR_RUNTIME_BUDGET.aggregateScriptBytes) {
      throw new TypeError("Edit runtime script aggregate exceeds the byte budget.");
    }
    scripts.push(Object.freeze({
      index: descriptor.index,
      bytes,
      sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      libraryOrigin,
    }));
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
 * One immutable resource session per authorized Script program. The same
 * session may serve repeated disposable iframe loads while the program
 * identity stays exact. It has no compatibility result, promotion document,
 * prewarm store or disk cache; a short idle cleanup bounds abandoned sessions.
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
  resolveSourceRoot = resolvePreviewSourceRoot,
  collectDeclaredAssets = collectDeclaredPreviewAssets,
  bundledEchartsPath = null,
  orphanSessionTtlMs = EDIT_AUTHOR_RUNTIME_BUDGET.orphanSessionTtlMs,
  runtimePreparationDeadlineMs = EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
} = {}) {
  if (!protocolApi || typeof protocolApi.handle !== "function") {
    throw new TypeError("Edit runtime protocol requires protocol.handle.");
  }
  if (typeof netFetch !== "function") {
    throw new TypeError("Edit runtime protocol requires Electron net.fetch.");
  }
  const boundedRuntimePreparationDeadlineMs = Math.max(1, Math.min(
    EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
    Math.round(Number(runtimePreparationDeadlineMs)) || EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
  ));
  const sessions = new Map();
  const installedProtocols = new WeakSet();
  const allocate = (create, predicate) => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const value = String(create() || "").toLowerCase();
      if (predicate(value)) return value;
    }
    throw new Error("Unable to allocate an Edit runtime identity.");
  };
  const pruneOrphans = (activeSessionId = null) => {
    const cutoff = now() - Math.max(1, Number(orphanSessionTtlMs) || 1);
    for (const [id, session] of sessions) {
      if (id !== activeSessionId && session.lastAccessAt < cutoff) sessions.delete(id);
    }
  };
  const prepareScripts = async ({
    source,
    sourceRoot,
    preparationController,
    preparationDeadlineAt,
  }) => {
    return settleWithinRuntimeDeadline(
      () => fixedAuthorScripts({
        html: source,
        sourceRoot,
        netFetch,
        readFileImpl,
        realpathImpl,
        statImpl,
        preparationDeadlineAt,
        preparationSignal: preparationController.signal,
        bundledEchartsPath,
      }),
      preparationController,
      preparationDeadlineAt,
      runtimePreparationTimeoutError,
    );
  };
  const createSession = async ({ html, sourcePath } = {}) => {
    const source = typeof html === "string" ? html : null;
    if (!source || utf8Bytes(source) > EDIT_AUTHOR_RUNTIME_BUDGET.htmlBytes) {
      throw new TypeError("Edit runtime source is invalid or too large.");
    }
    const preparationController = new AbortController();
    const preparationDeadlineAt = Date.now() + boundedRuntimePreparationDeadlineMs;
    const sourceRoot = await settleWithinRuntimeDeadline(
      () => resolveSourceRoot(sourcePath),
      preparationController,
      preparationDeadlineAt,
      runtimePreparationTimeoutError,
    );
    if (!sourceRoot) throw new TypeError("Edit runtime requires a known local source path.");
    const frozenScripts = await prepareScripts({
      source,
      sourceRoot,
      preparationController,
      preparationDeadlineAt,
    });
    const declaredAssets = await settleWithinRuntimeDeadline(
      () => collectDeclaredAssets({
        html: source,
        sourceRoot,
        maxAssets: EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetCount,
        maxReferences: EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetReferenceCount,
        maxDependencyScanBytes: EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetBytes,
        signal: preparationController.signal,
      }),
      preparationController,
      preparationDeadlineAt,
      runtimePreparationTimeoutError,
    );
    pruneOrphans();
    const sessionId = allocate(randomSessionId, (candidate) => (
      isEditRuntimeSessionId(candidate) && !sessions.has(candidate)
    ));
    const executionId = allocate(randomExecutionId, isEditRuntimeExecutionId);
    const lastAccessAt = now();
    sessions.set(sessionId, {
      sessionId,
      executionId,
      sourceRoot,
      declaredAssets,
      scripts: frozenScripts.scripts.map((script) => ({ ...script })),
      byteLength: frozenScripts.byteLength,
      resourceSha256: frozenScripts.resourceSha256,
      lastAccessAt,
    });
    return Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      sessionId,
      executionId,
      scriptCount: frozenScripts.scripts.length,
      resourceSha256: frozenScripts.resourceSha256,
      byteLength: frozenScripts.byteLength,
      libraryOrigins: Object.freeze([
        ...new Set(frozenScripts.scripts.map((script) => script.libraryOrigin)),
      ]),
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
    const sessionId = sessionIdFrom(requestUrl.hostname);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (session) session.lastAccessAt = now();
    pruneOrphans(sessionId);
    if (!session) return notFound();
    const bootstrap = requestUrl.pathname.match(BOOTSTRAP_PATH);
    if (bootstrap) {
      if (executionIdFrom(bootstrap[1]) !== session.executionId) return notFound();
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
      ) return notFound();
      return response(
        request.method === "HEAD" ? null : script.bytes,
        200,
        "text/javascript; charset=utf-8",
      );
    }
    const relative = normalizeRelativeAssetPath(requestUrl.pathname);
    if (!relative) return notFound();
    const asset = session.declaredAssets.get(relative);
    if (!asset) return notFound();
    try {
      const resolved = await realpathImpl(asset.resolvedPath);
      if (resolved !== asset.resolvedPath || !containedPath(session.sourceRoot, resolved)) {
        return notFound();
      }
      const information = await statImpl(resolved);
      if (
        !information.isFile()
        || information.size > EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetBytes
      ) return notFound();
      if (request.method === "HEAD") {
        return response(null, 200, assetContentType(relative));
      }
      const assetResponse = await netFetch(pathToFileURL(resolved).href, {
        method: "GET",
        cache: "no-store",
      });
      if (!assetResponse?.ok || !assetResponse.body) return notFound();
      return response(
        assetResponse.body,
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
    dispose: () => {
      sessions.clear();
    },
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
