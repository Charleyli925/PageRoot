import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { PRODUCT_MAX_HTML_BYTES } from "./product-contract.mjs";

const DEFAULT_MAX_HTML_BYTES = PRODUCT_MAX_HTML_BYTES;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const perSourceQueues = new Map();
const lastPersistedStates = new Map();

function decodeUtf8Html(buffer, sourcePath) {
  try {
    // `ignoreBOM: true` preserves an authored UTF-8 BOM as U+FEFF so hashing
    // and subsequent SourcePatch writes remain byte-exact.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch (cause) {
    throw new ProjectFileError(
      "UNSUPPORTED_HTML_ENCODING",
      "当前文件不是 UTF-8 编码。为了不损坏原文件，源页只允许浏览和添加评论。",
      { sourcePath, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

export class ProjectFileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectFileError";
    this.code = code;
    this.details = details;
  }
}

export function htmlSha256(html) {
  return `sha256:${createHash("sha256").update(html, "utf8").digest("hex")}`;
}

export function normalizeProjectFileError(error) {
  if (error instanceof ProjectFileError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details,
    };
  }
  return {
    code: "FILE_OPERATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function validateHtml(
  html,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
  { requireComplete = true } = {},
) {
  if (typeof html !== "string") {
    throw new ProjectFileError("INVALID_HTML", "HTML 内容必须是字符串。");
  }
  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > maxHtmlBytes) {
    throw new ProjectFileError(
      "HTML_TOO_LARGE",
      `HTML 文件不能超过 ${Math.floor(maxHtmlBytes / 1024 / 1024)} MB。`,
      { byteLength, maxHtmlBytes },
    );
  }
  const source = html.replace(/^\uFEFF/, "");
  if (
    requireComplete
    && (!/<html(?:\s|>)/i.test(source) || !/<\/html\s*>/i.test(source))
  ) {
    throw new ProjectFileError(
      "INVALID_HTML",
      "HTML 必须是包含完整 <html> 根元素的页面。",
    );
  }
  return byteLength;
}

function validateExpectedSha256(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new ProjectFileError(
      "INVALID_EXPECTED_SHA256",
      "expectedSha256 必须使用 sha256:<64 位十六进制> 格式。",
    );
  }
  return normalized;
}

function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProjectFileError(
      "INVALID_EDIT_REVISION",
      "editRevision 必须是非负安全整数。",
    );
  }
  return value;
}

function sourceQueueKey(sourcePath) {
  return process.platform === "win32"
    ? sourcePath.toLowerCase()
    : sourcePath;
}

function runForSource(sourcePath, operation) {
  const key = sourceQueueKey(sourcePath);
  const previous = perSourceQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const queueTail = result.catch(() => undefined).finally(() => {
    if (perSourceQueues.get(key) === queueTail) perSourceQueues.delete(key);
  });
  perSourceQueues.set(key, queueTail);
  return result;
}

async function inspectExistingHtmlFile(sourcePath, maxHtmlBytes) {
  let information;
  try {
    information = await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProjectFileError(
        "SOURCE_NOT_FOUND",
        "源 HTML 已不存在。",
        { sourcePath },
      );
    }
    throw error;
  }
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new ProjectFileError(
      "UNSAFE_SOURCE",
      "只能更新普通 HTML 文件，不能覆盖文件夹或符号链接。",
      { sourcePath },
    );
  }
  if (information.size > maxHtmlBytes) {
    throw new ProjectFileError(
      "HTML_TOO_LARGE",
      `HTML 文件不能超过 ${Math.floor(maxHtmlBytes / 1024 / 1024)} MB。`,
      { sourcePath, byteLength: information.size, maxHtmlBytes },
    );
  }
  return information;
}

async function syncDirectory(directoryPath) {
  let directoryHandle;
  try {
    directoryHandle = await open(directoryPath, "r");
    await directoryHandle.sync();
  } catch {
    // Directory fsync is not supported by every filesystem. The file itself
    // has already been flushed and atomically renamed, so this is best effort.
  } finally {
    await directoryHandle?.close().catch(() => {});
  }
}

async function writeTemporaryHtml({
  sourcePath,
  html,
  mode,
  maxHtmlBytes,
}) {
  const directoryPath = path.dirname(sourcePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(sourcePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(html, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    const temporaryHtml = await readFile(temporaryPath, "utf8");
    validateHtml(temporaryHtml, maxHtmlBytes);
    const expectedOutputSha256 = htmlSha256(html);
    const temporarySha256 = htmlSha256(temporaryHtml);
    if (temporarySha256 !== expectedOutputSha256) {
      throw new ProjectFileError(
        "TEMPORARY_FILE_MISMATCH",
        "临时 HTML 重新读取后的内容与目标内容不一致。",
        {
          sourcePath,
          expectedOutputSha256,
          temporarySha256,
        },
      );
    }
    return {
      temporaryPath,
      outputSha256: expectedOutputSha256,
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function currentFileSnapshot(sourcePath, maxHtmlBytes) {
  const information = await inspectExistingHtmlFile(sourcePath, maxHtmlBytes);
  const html = decodeUtf8Html(await readFile(sourcePath), sourcePath);
  validateHtml(html, maxHtmlBytes, { requireComplete: false });
  return {
    html,
    sha256: htmlSha256(html),
    lastModifiedAt: information.mtime.toISOString(),
  };
}

export async function readHtmlFile({
  sourcePath,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
}) {
  const resolvedPath = path.resolve(sourcePath);
  const snapshot = await currentFileSnapshot(resolvedPath, maxHtmlBytes);
  return {
    sourcePath: resolvedPath,
    path: resolvedPath,
    name: path.basename(resolvedPath),
    ...snapshot,
  };
}

export async function persistHtmlFile({
  projectId,
  documentId,
  sourcePath,
  html,
  expectedSha256,
  editRevision,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
}) {
  const resolvedPath = path.resolve(sourcePath);
  validateHtml(html, maxHtmlBytes);
  const normalizedExpectedSha256 = validateExpectedSha256(expectedSha256);
  const revision = validateRevision(editRevision);

  return runForSource(resolvedPath, async () => {
    const key = sourceQueueKey(resolvedPath);
    const knownState = lastPersistedStates.get(key);
    const knownRevision = knownState?.revision;
    if (knownRevision !== undefined && revision <= knownRevision) {
      const current = await currentFileSnapshot(resolvedPath, maxHtmlBytes);
      const requestedSha256 = htmlSha256(html);
      if (revision === knownRevision && current.sha256 !== requestedSha256) {
        throw new ProjectFileError(
          "REVISION_CONFLICT",
          "同一个 editRevision 对应了不同的 HTML 内容。",
          {
            sourcePath: resolvedPath,
            editRevision: revision,
            persistedRevision: knownRevision,
            requestedSha256,
            actualSha256: current.sha256,
          },
        );
      }
      return {
        ok: true,
        projectId,
        documentId,
        sourcePath: resolvedPath,
        path: resolvedPath,
        name: path.basename(resolvedPath),
        html: current.html,
        sha256: current.sha256,
        lastModifiedAt: current.lastModifiedAt,
        persistedRevision: knownRevision,
        skipped: true,
        skipReason: "stale-revision",
      };
    }

    const existing = await inspectExistingHtmlFile(resolvedPath, maxHtmlBytes);
    const mode = existing.mode & 0o777;
    const temporary = await writeTemporaryHtml({
      sourcePath: resolvedPath,
      html,
      mode,
      maxHtmlBytes,
    });

    try {
      // This check intentionally happens inside the per-source queue and
      // immediately before rename. It is the compare step of compare-and-swap.
      const beforeReplaceHtml = decodeUtf8Html(
        await readFile(resolvedPath),
        resolvedPath,
      );
      const actualSha256 = htmlSha256(beforeReplaceHtml);
      const sourceStillOwnedByQueue = Boolean(
        knownState
        && revision > knownState.revision
        && actualSha256 === knownState.sha256
      );
      if (
        normalizedExpectedSha256
        && actualSha256 !== normalizedExpectedSha256
        && !sourceStillOwnedByQueue
      ) {
        throw new ProjectFileError(
          "SOURCE_CHANGED",
          "原 HTML 已被其他程序修改，工作台没有覆盖它。",
          {
            sourcePath: resolvedPath,
            expectedSha256: normalizedExpectedSha256,
            actualSha256,
            editRevision: revision,
          },
        );
      }

      await rename(temporary.temporaryPath, resolvedPath);
      await syncDirectory(path.dirname(resolvedPath));

      const persistedHtml = decodeUtf8Html(
        await readFile(resolvedPath),
        resolvedPath,
      );
      validateHtml(persistedHtml, maxHtmlBytes);
      const persistedSha256 = htmlSha256(persistedHtml);
      if (persistedSha256 !== temporary.outputSha256) {
        throw new ProjectFileError(
          "PERSISTED_FILE_MISMATCH",
          "源 HTML 原子替换后的内容校验失败。",
          {
            sourcePath: resolvedPath,
            expectedOutputSha256: temporary.outputSha256,
            actualSha256: persistedSha256,
            editRevision: revision,
          },
        );
      }
      const persistedStats = await stat(resolvedPath);
      lastPersistedStates.set(key, {
        revision,
        sha256: persistedSha256,
      });
      return {
        ok: true,
        projectId,
        documentId,
        sourcePath: resolvedPath,
        path: resolvedPath,
        name: path.basename(resolvedPath),
        html: persistedHtml,
        sha256: persistedSha256,
        lastModifiedAt: persistedStats.mtime.toISOString(),
        persistedRevision: revision,
        skipped: false,
      };
    } finally {
      await unlink(temporary.temporaryPath).catch(() => {});
    }
  });
}

export async function writeHtmlCopy({
  destinationPath,
  html,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
}) {
  const resolvedPath = path.resolve(destinationPath);
  validateHtml(html, maxHtmlBytes);
  return runForSource(resolvedPath, async () => {
    let mode = 0o600;
    try {
      const existing = await lstat(resolvedPath);
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new ProjectFileError(
          "UNSAFE_DESTINATION",
          "HTML 副本只能写入普通文件路径。",
          { destinationPath: resolvedPath },
        );
      }
      mode = existing.mode & 0o777;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = await stat(path.dirname(resolvedPath));
      if (!parent.isDirectory()) {
        throw new ProjectFileError(
          "INVALID_DESTINATION",
          "HTML 副本的目标文件夹不存在。",
          { destinationPath: resolvedPath },
        );
      }
    }

    const temporary = await writeTemporaryHtml({
      sourcePath: resolvedPath,
      html,
      mode,
      maxHtmlBytes,
    });
    try {
      await rename(temporary.temporaryPath, resolvedPath);
      await syncDirectory(path.dirname(resolvedPath));
      const persistedHtml = decodeUtf8Html(
        await readFile(resolvedPath),
        resolvedPath,
      );
      const persistedSha256 = htmlSha256(persistedHtml);
      if (persistedSha256 !== temporary.outputSha256) {
        throw new ProjectFileError(
          "EXPORTED_FILE_MISMATCH",
          "导出的 HTML 副本校验失败。",
          {
            destinationPath: resolvedPath,
            expectedOutputSha256: temporary.outputSha256,
            actualSha256: persistedSha256,
          },
        );
      }
      const persistedStats = await stat(resolvedPath);
      return {
        ok: true,
        path: resolvedPath,
        sourcePath: resolvedPath,
        name: path.basename(resolvedPath),
        html: persistedHtml,
        sha256: persistedSha256,
        lastModifiedAt: persistedStats.mtime.toISOString(),
      };
    } finally {
      await unlink(temporary.temporaryPath).catch(() => {});
    }
  });
}

export function resetProjectFileQueuesForTests() {
  perSourceQueues.clear();
  lastPersistedStates.clear();
}
