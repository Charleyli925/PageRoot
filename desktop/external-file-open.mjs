import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

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

export function createExternalFileOpenMailbox({
  createRequestId = randomUUID,
  platform = process.platform,
} = {}) {
  let pending = null;

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
    consume(requestId) {
      if (
        !pending
        || typeof requestId !== "string"
        || requestId !== pending.requestId
      ) return null;
      const request = pending;
      pending = null;
      return request;
    },
  });
}
