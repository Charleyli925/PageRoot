import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectFileError } from "./project-files.mjs";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const EXTERNAL_OPEN_FAILURE = Object.freeze({
  code: "EXTERNAL_OPEN_FAILED",
  message: "无法读取这个 HTML 文件。请确认文件仍存在且具有访问权限。",
});

function pathImplementation(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function normalizeExternalHtmlPath(
  value,
  { platform = process.platform } = {},
) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new TypeError("外部 HTML 路径无效。");
  }

  let candidate = value.trim();
  if (/^file:/iu.test(candidate)) {
    candidate = fileURLToPath(new URL(candidate), {
      windows: platform === "win32",
    });
  }

  const pathApi = pathImplementation(platform);
  if (!pathApi.isAbsolute(candidate)) {
    throw new TypeError("外部 HTML 路径必须是绝对路径。");
  }
  const normalized = pathApi.normalize(candidate);
  if (!HTML_EXTENSIONS.has(pathApi.extname(normalized).toLowerCase())) {
    throw new TypeError("只能从外部打开 .html 或 .htm 文件。");
  }
  return normalized;
}

export function externalHtmlPathsFromArgv(
  argv,
  { platform = process.platform } = {},
) {
  if (!Array.isArray(argv)) return [];
  const results = [];
  const identities = new Set();
  for (const argument of argv) {
    if (typeof argument !== "string" || argument.startsWith("-")) continue;
    try {
      const sourcePath = normalizeExternalHtmlPath(argument, { platform });
      const identity = platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
      if (identities.has(identity)) continue;
      identities.add(identity);
      results.push(sourcePath);
    } catch {
      // Chromium flags, the executable path and unrelated arguments are ignored.
    }
  }
  return results;
}

/**
 * Native startup happens before a renderer can safely present an IPC error.
 * Keep the native dialog product-facing: filesystem exceptions commonly
 * include a full local path, syscall and platform-specific implementation
 * detail. Product file errors already carry a stable code and message.
 */
export function externalOpenFailurePresentation(error) {
  if (error instanceof ProjectFileError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
    });
  }
  return EXTERNAL_OPEN_FAILURE;
}

export function createExternalFileOpenMailbox({
  createRequestId = randomUUID,
  platform = process.platform,
} = {}) {
  let pending = null;
  let activationTail = Promise.resolve();

  const consume = (requestId) => {
    if (
      !pending
      || typeof requestId !== "string"
      || requestId !== pending.requestId
    ) return null;
    const request = pending;
    pending = null;
    return request;
  };

  return Object.freeze({
    publish(value) {
      const request = Object.freeze({
        requestId: createRequestId(),
        sourcePath: normalizeExternalHtmlPath(value, { platform }),
      });
      // PageRoot is a single-document workspace. A newer OS open request
      // supersedes an older request that the renderer has not accepted yet.
      pending = request;
      return request;
    },
    peek() {
      return pending;
    },
    consume,
    accept(requestId, activate) {
      const request = consume(requestId);
      if (!request) return null;
      if (typeof activate !== "function") {
        throw new TypeError("外部 HTML 打开处理器无效。");
      }
      // `activate` owns the read + active-project mutation. Keep that entire
      // operation in one FIFO so a slow earlier request cannot overwrite the
      // newer active/recent source after the renderer has moved on.
      const operation = activationTail.then(() => activate(request));
      activationTail = operation.catch(() => undefined);
      return operation;
    },
  });
}
