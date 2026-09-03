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
  isEditRuntimeSourceSha256,
  unsupportedEditRuntimeProgramReason,
} from "../app/domain/edit-runtime-contract.js";
import { createEditRuntimeBootstrap } from "./edit-runtime-bootstrap.mjs";
import { classifyExactImmutableEchartsUrl } from "./edit-runtime-library-store.mjs";
import {
  collectDeclaredPreviewAssets,
  normalizeRelativeAssetPath,
  resolveContainedDocumentBase,
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
const BUNDLED_ECHARTS_VERSION = "5.6.0";
const COMPATIBLE_ECHARTS_SOURCE_VERSION = "5.4.3";
const BUNDLED_ECHARTS_SHA256 =
  "bf4a223524e40b77c304bec67e1222cf551f14880cf42c69dc046558e11c07b1";

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

function isExecutableAssetPath(relativePath) {
  return SCRIPT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

async function resolveLocalScript(sourceRoot, reference, {
  basePath = "",
  readFileImpl,
  realpathImpl,
  statImpl,
}) {
  const relative = normalizeRelativeAssetPath(reference, basePath);
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
  const classification = classifyExactImmutableEchartsUrl(value);
  return classification?.version === BUNDLED_ECHARTS_VERSION
    && classification.fileName === "echarts.min.js";
}

function isCompatibleEchartsSourceUrl(value) {
  const classification = classifyExactImmutableEchartsUrl(value);
  return classification?.version === COMPATIBLE_ECHARTS_SOURCE_VERSION
    && classification.fileName === "echarts.min.js"
    && new URL(classification.url).search === "";
}

function sameImmutableEchartsIdentity(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.version === right.version
    && left.fileName === right.fileName
    && new URL(left.url).search === new URL(right.url).search;
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

async function fetchFixedEchartsBytes(initialUrl, netFetch, deadlineAt) {
  let url = String(initialUrl);
  const initialImmutable = classifyExactImmutableEchartsUrl(url);
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    if (!permittedEchartsUrl(url)) {
      throw new TypeError("Edit runtime remote script is not an allowed ECharts CDN URL.");
    }
    if (
      initialImmutable
      && !sameImmutableEchartsIdentity(
        initialImmutable,
        classifyExactImmutableEchartsUrl(url),
      )
    ) {
      throw new TypeError("Edit runtime CDN redirect changed the immutable script identity.");
    }
    const controller = new AbortController();
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
      if (redirectCount === 4) {
        controller.abort();
        throw new TypeError("Edit runtime CDN redirect limit exceeded.");
      }
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
    return readFixedEchartsBytes(responseValue, controller, deadlineAt);
  }
  throw new TypeError("Edit runtime CDN redirect limit exceeded.");
}

export { fetchFixedEchartsBytes };

function validatedScriptBytes(value) {
  const bytes = Buffer.from(value || []);
  if (bytes.byteLength < 1 || bytes.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes) {
    throw new TypeError("Edit runtime script exceeds the byte budget.");
  }
  const programReason = unsupportedEditRuntimeProgramReason(bytes.toString("utf8"));
  if (programReason) {
    throw new TypeError("Edit runtime script is unsupported: " + programReason + ".");
  }
  return bytes;
}

function freezeAuthorScripts(scriptValues, documentBasePath) {
  let totalBytes = 0;
  const scripts = scriptValues.map((script) => {
    const bytes = validatedScriptBytes(script.bytes);
    totalBytes += bytes.byteLength;
    if (totalBytes > EDIT_AUTHOR_RUNTIME_BUDGET.aggregateScriptBytes) {
      throw new TypeError("Edit runtime script aggregate exceeds the byte budget.");
    }
    return Object.freeze({
      index: script.index,
      bytes,
      sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      libraryOrigin: script.libraryOrigin,
    });
  });
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
    documentBasePath,
  });
}

function compatibleContractExternalUrl(contract) {
  const externalScripts = contract.executableScripts.filter((descriptor) => descriptor.src !== null);
  if (externalScripts.length !== 1) return null;
  const candidate = externalScripts[0].src;
  const hasIntegrity = externalScripts[0].attributes.some((attribute) => (
    attribute.name === "integrity"
  ));
  return !hasIntegrity && isCompatibleEchartsSourceUrl(candidate) ? candidate : null;
}

async function prepareAuthorScripts({
  html,
  documentBase,
  sourceRoot,
  netFetch,
  runtimeLibraryStore,
  readFileImpl,
  realpathImpl,
  statImpl,
  bundledEchartsPath,
  remoteLibraryDeadlineMs,
}) {
  const contract = collectEditRuntimeScripts(html);
  if (contract.unsupportedReason) {
    throw new TypeError("Edit runtime script is unsupported: " + contract.unsupportedReason + ".");
  }
  if (
    contract.executableScripts.length < 1
    || contract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
  ) throw new TypeError("Edit runtime script count is invalid.");
  const compatibleExternalUrl = compatibleContractExternalUrl(contract);
  const scripts = new Array(contract.executableScripts.length);
  const pendingRemoteScripts = [];
  let compatiblePendingIndex = null;
  let bundledBytesPromise = null;
  const readBundledBytes = async () => {
    if (!bundledEchartsPath) {
      throw new TypeError("Bundled ECharts bytes are unavailable.");
    }
    if (!bundledBytesPromise) {
      bundledBytesPromise = Promise.resolve(readFileImpl(bundledEchartsPath)).then((value) => {
        const bytes = validatedScriptBytes(value);
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== BUNDLED_ECHARTS_SHA256) {
          throw new TypeError("Bundled ECharts bytes failed integrity verification.");
        }
        return bytes;
      });
    }
    return bundledBytesPromise;
  };
  for (let position = 0; position < contract.executableScripts.length; position += 1) {
    const descriptor = contract.executableScripts[position];
    let libraryOrigin = descriptor.src ? "local" : "inline";
    let bytes;
    if (descriptor.src && permittedEchartsUrl(descriptor.src)) {
      const fetchRemote = async () => validatedScriptBytes(await fetchFixedEchartsBytes(
        descriptor.src,
        netFetch,
        Date.now() + remoteLibraryDeadlineMs,
      ));
      if (bundledEchartsPath && isBundledEchartsUrl(descriptor.src)) {
        bytes = await readBundledBytes();
        libraryOrigin = "bundled";
      } else {
        const immutable = classifyExactImmutableEchartsUrl(descriptor.src);
        const cached = immutable && runtimeLibraryStore?.get
          ? await runtimeLibraryStore.get(immutable.url)
          : null;
        if (cached) {
          bytes = validatedScriptBytes(cached.bytes);
          libraryOrigin = "disk-cache";
        } else {
          const exactLoad = immutable && runtimeLibraryStore?.load
            ? runtimeLibraryStore.load(immutable.url, fetchRemote)
            : fetchRemote().then((remoteBytes) => Object.freeze({
                bytes: remoteBytes,
                origin: "network",
              }));
          const exactScript = Promise.resolve(exactLoad).then((loaded) => ({
            index: descriptor.index,
            bytes: validatedScriptBytes(loaded.bytes),
            libraryOrigin: loaded.origin === "disk-cache" ? "disk-cache" : "network",
          }));
          pendingRemoteScripts.push({ position, exactScript });
          if (
            descriptor.src === compatibleExternalUrl
            && bundledEchartsPath
            && runtimeLibraryStore?.load
          ) {
            bytes = await readBundledBytes();
            libraryOrigin = "bundled-compatible";
            compatiblePendingIndex = position;
          } else {
            continue;
          }
        }
      }
    } else if (descriptor.src) {
      bytes = await resolveLocalScript(sourceRoot, descriptor.src, {
        basePath: documentBase.basePath,
        readFileImpl,
        realpathImpl,
        statImpl,
      });
    } else {
      bytes = Buffer.from(descriptor.inline, "utf8");
    }
    scripts[position] = {
      index: descriptor.index,
      bytes: validatedScriptBytes(bytes),
      libraryOrigin,
    };
  }
  if (!pendingRemoteScripts.length) {
    return Object.freeze({
      resourceMode: "exact",
      current: freezeAuthorScripts(scripts, documentBase.documentPath),
      exactPromise: null,
    });
  }
  const exactPromise = Promise.all(pendingRemoteScripts.map(async ({ position, exactScript }) => {
    const script = await exactScript;
    return { position, script };
  })).then((loadedScripts) => {
    const exactScripts = [...scripts];
    for (const { position, script } of loadedScripts) exactScripts[position] = script;
    return freezeAuthorScripts(exactScripts, documentBase.documentPath);
  });
  void exactPromise.catch(() => undefined);
  if (compatiblePendingIndex !== null && pendingRemoteScripts.length === 1) {
    return Object.freeze({
      resourceMode: "compatible",
      current: freezeAuthorScripts(scripts, documentBase.documentPath),
      exactPromise,
    });
  }
  return Object.freeze({
    resourceMode: "exact",
    current: null,
    exactPromise,
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

function normalizedRecoveryIdentity(value) {
  const sourceSha256 = String(value?.sourceSha256 || "").toLowerCase();
  const authoritySourcePath = typeof value?.authoritySourcePath === "string"
    ? value.authoritySourcePath
    : "";
  if (
    !isEditRuntimeSourceSha256(sourceSha256)
    || !authoritySourcePath
    || typeof value?.programIdentity !== "string"
    || !value.programIdentity
    || !Number.isSafeInteger(value.canvasGeneration)
    || value.canvasGeneration < 0
  ) return null;
  return Object.freeze({
    sourceSha256,
    authoritySourcePath,
    programIdentity: value.programIdentity,
    canvasGeneration: value.canvasGeneration,
  });
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
 * One immutable resource session per authorized Script program. A narrowly
 * compatible ECharts resource is a separate immutable program and may derive
 * one later exact session from the same initial preparation. Neither result
 * changes source HTML or promotes Runtime DOM into source authority.
 */
export function createEditRuntimeProtocolController({
  protocolApi,
  netFetch,
  runtimeLibraryStore = null,
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
  remoteLibraryDeadlineMs = EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs,
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
  const boundedRemoteLibraryDeadlineMs = Math.max(1, Math.min(
    EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs,
    Math.round(Number(remoteLibraryDeadlineMs))
      || EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs,
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
    documentBase,
    preparationController,
    preparationDeadlineAt,
  }) => {
    return settleWithinRuntimeDeadline(
      () => prepareAuthorScripts({
        html: source,
        documentBase,
        sourceRoot,
        netFetch,
        runtimeLibraryStore,
        readFileImpl,
        realpathImpl,
        statImpl,
        bundledEchartsPath,
        remoteLibraryDeadlineMs: boundedRemoteLibraryDeadlineMs,
      }),
      preparationController,
      preparationDeadlineAt,
      runtimePreparationTimeoutError,
    );
  };
  const allocateSessionId = () => allocate(randomSessionId, (candidate) => (
    isEditRuntimeSessionId(candidate) && !sessions.has(candidate)
  ));
  const allocateExecutionId = (excludedExecutionId = null) => allocate(
    randomExecutionId,
    (candidate) => isEditRuntimeExecutionId(candidate) && candidate !== excludedExecutionId,
  );
  const installFrozenSession = ({
    frozenScripts,
    sourceRoot,
    declaredAssets,
    resourceMode,
    exactPromise = null,
    recoveryIdentity = null,
    excludedExecutionId = null,
  }) => {
    const sessionId = allocateSessionId();
    const executionId = allocateExecutionId(excludedExecutionId);
    const record = {
      sessionId,
      executionId,
      sourceRoot,
      declaredAssets: new Map(declaredAssets),
      scripts: frozenScripts.scripts.map((script) => ({
        ...script,
        bytes: Buffer.from(script.bytes),
      })),
      byteLength: frozenScripts.byteLength,
      resourceSha256: frozenScripts.resourceSha256,
      documentBasePath: frozenScripts.documentBasePath,
      resourceMode,
      recovery: resourceMode === "compatible"
        ? { consumed: false, exactPromise, identity: recoveryIdentity }
        : null,
      lastAccessAt: now(),
    };
    sessions.set(sessionId, record);
    const descriptor = {
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      sessionId,
      executionId,
      scriptCount: record.scripts.length,
      resourceSha256: record.resourceSha256,
      documentBasePath: record.documentBasePath,
      byteLength: record.byteLength,
      resourceMode,
      libraryOrigins: Object.freeze([
        ...new Set(record.scripts.map((script) => script.libraryOrigin)),
      ]),
    };
    if (resourceMode === "compatible") descriptor.recoveryAvailable = true;
    return Object.freeze(descriptor);
  };
  const createSession = async ({ html, sourcePath, recoveryIdentity = null } = {}) => {
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
    const documentBase = resolveContainedDocumentBase(source);
    if (!documentBase) {
      throw new TypeError("Edit runtime document base is outside the authorized source root.");
    }
    const scriptPreparation = await prepareScripts({
      source,
      sourceRoot,
      documentBase,
      preparationController,
      preparationDeadlineAt,
    });
    const discoveredAssets = await settleWithinRuntimeDeadline(
      () => collectDeclaredAssets({
        html: source,
        sourceRoot,
        documentBasePath: documentBase.basePath,
        maxAssets: EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetCount,
        maxReferences: EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetReferenceCount,
        maxDependencyScanBytes: EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetBytes,
        signal: preparationController.signal,
      }),
      preparationController,
      preparationDeadlineAt,
      runtimePreparationTimeoutError,
    );
    const declaredAssets = new Map(
      [...discoveredAssets].filter(([relativePath]) => !isExecutableAssetPath(relativePath)),
    );
    const frozenScripts = scriptPreparation.current
      || await scriptPreparation.exactPromise;
    const boundRecoveryIdentity = scriptPreparation.resourceMode === "compatible"
      ? normalizedRecoveryIdentity(recoveryIdentity)
      : null;
    if (scriptPreparation.resourceMode === "compatible" && !boundRecoveryIdentity) {
      throw new TypeError("Edit runtime compatible recovery requires source identity.");
    }
    pruneOrphans();
    return installFrozenSession({
      frozenScripts,
      sourceRoot,
      declaredAssets,
      resourceMode: scriptPreparation.resourceMode,
      exactPromise: scriptPreparation.exactPromise,
      recoveryIdentity: boundRecoveryIdentity,
    });
  };
  const recoverSession = async (value) => {
    const sessionId = sessionIdFrom(value?.sessionId);
    const compatibleSession = sessionId ? sessions.get(sessionId) : null;
    if (
      !compatibleSession
      || compatibleSession.resourceMode !== "compatible"
      || !compatibleSession.recovery?.exactPromise
    ) {
      throw new TypeError("Edit runtime session has no compatible recovery.");
    }
    const expectedIdentity = compatibleSession.recovery.identity;
    if (
      !expectedIdentity
      || !isEditRuntimeSourceSha256(value?.sourceSha256)
      || value.sourceSha256.toLowerCase() !== expectedIdentity.sourceSha256
      || typeof value.authoritySourcePath !== "string"
      || value.authoritySourcePath !== expectedIdentity.authoritySourcePath
      || typeof value.programIdentity !== "string"
      || value.programIdentity !== expectedIdentity.programIdentity
      || value.canvasGeneration !== expectedIdentity.canvasGeneration
    ) {
      throw new TypeError("Edit runtime compatible recovery identity is invalid.");
    }
    if (compatibleSession.recovery.consumed) {
      throw new TypeError("Edit runtime compatible recovery was already consumed.");
    }
    compatibleSession.recovery.consumed = true;
    const frozenScripts = await compatibleSession.recovery.exactPromise;
    pruneOrphans(compatibleSession.sessionId);
    return installFrozenSession({
      frozenScripts,
      sourceRoot: compatibleSession.sourceRoot,
      declaredAssets: compatibleSession.declaredAssets,
      resourceMode: "exact",
      excludedExecutionId: compatibleSession.executionId,
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
    if (!relative || isExecutableAssetPath(relative)) return notFound();
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
    recoverSession,
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
