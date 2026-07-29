import { randomBytes } from "node:crypto";
import {
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PREVIEW_PROTOCOL_SCHEME = "pageroot-preview";
export const PREVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";

const DEFAULT_MAX_HTML_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;

let schemePrivilegesRegistered = false;

function utf8ByteLength(value) {
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

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/u, "");
    } catch {
      return invalidRequest();
    }
    if (!decodedPath || decodedPath.includes("\0")) return invalidRequest();
    const candidatePath = path.resolve(session.sourceRoot, decodedPath);
    if (!isContainedPath(session.sourceRoot, candidatePath)) return invalidRequest();

    try {
      const resolvedPath = await realpath(candidatePath);
      if (!isContainedPath(session.sourceRoot, resolvedPath)) return invalidRequest();
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
