import { lstat, stat } from "node:fs/promises";
import path from "node:path";

import { ProjectFileError } from "./project-files.mjs";

export const PROJECT_IPC_PROTOCOL = "html-ai-project-result";
export const PROJECT_IPC_VERSION = 1;

const GENERIC_PROJECT_ERROR = Object.freeze({
  code: "FILE_OPERATION_FAILED",
  message: "本地文件操作没有完成，请重试或选择其他位置。",
});

function serializableDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, detail]) => (
    detail === null
    || typeof detail === "string"
    || typeof detail === "number"
    || typeof detail === "boolean"
  ));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function normalizeProjectIpcError(error) {
  if (error instanceof ProjectFileError) {
    const details = serializableDetails(error.details);
    return {
      code: error.code,
      message: error.message,
      ...(details ? { details } : {}),
    };
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return {
      code: "INVALID_FILE_REQUEST",
      message: error.message,
    };
  }

  switch (error?.code) {
    case "ENOENT":
      return {
        code: "FILE_NOT_FOUND",
        message: "文件或文件夹已不存在，请重新选择。",
      };
    case "EACCES":
    case "EPERM":
      return {
        code: "PERMISSION_DENIED",
        message: "没有访问该位置的权限，请选择其他位置。",
      };
    case "ENOSPC":
      return {
        code: "DISK_FULL",
        message: "磁盘空间不足，源文件没有被改动。",
      };
    case "EROFS":
      return {
        code: "READ_ONLY_DESTINATION",
        message: "所选位置是只读的，请选择其他位置。",
      };
    case "ENOTDIR":
    case "EISDIR":
      return {
        code: "INVALID_DESTINATION",
        message: "所选导出位置无效，请重新选择文件夹和文件名。",
      };
    default:
      return GENERIC_PROJECT_ERROR;
  }
}

export async function runProjectIpcOperation(operation, { onError } = {}) {
  try {
    return {
      protocol: PROJECT_IPC_PROTOCOL,
      version: PROJECT_IPC_VERSION,
      ok: true,
      value: await operation(),
    };
  } catch (error) {
    const normalized = normalizeProjectIpcError(error);
    onError?.(error, normalized);
    return {
      protocol: PROJECT_IPC_PROTOCOL,
      version: PROJECT_IPC_VERSION,
      ok: false,
      error: normalized,
    };
  }
}

export function normalizedPathKey(value, platform = process.platform) {
  let normalized = path.resolve(value).normalize("NFC");
  if (platform === "darwin" || platform === "win32") {
    normalized = normalized.toLocaleLowerCase("en-US");
  }
  return normalized;
}

async function existingIdentity(filePath, statFile) {
  try {
    const information = await statFile(filePath);
    return {
      dev: String(information.dev),
      ino: String(information.ino),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function pathsReferToSameFile(
  firstPath,
  secondPath,
  {
    platform = process.platform,
    statFile = stat,
  } = {},
) {
  if (!firstPath || !secondPath) return false;
  if (
    normalizedPathKey(firstPath, platform)
    === normalizedPathKey(secondPath, platform)
  ) {
    return true;
  }

  const [firstIdentity, secondIdentity] = await Promise.all([
    existingIdentity(firstPath, statFile),
    existingIdentity(secondPath, statFile),
  ]);
  return Boolean(
    firstIdentity
    && secondIdentity
    && firstIdentity.ino !== "0"
    && firstIdentity.dev === secondIdentity.dev
    && firstIdentity.ino === secondIdentity.ino,
  );
}

export async function isProtectedExportDestination(
  destinationPath,
  protectedPaths,
  options = {},
) {
  for (const protectedPath of new Set(protectedPaths.filter(Boolean))) {
    if (await pathsReferToSameFile(destinationPath, protectedPath, options)) {
      return true;
    }
  }
  return false;
}

function exportNameParts(suggestedName) {
  const name = path.basename(suggestedName || "HTML.html");
  const parsed = path.parse(name);
  const hasHtmlExtension = [".html", ".htm"].includes(parsed.ext.toLowerCase());
  const extension = hasHtmlExtension ? parsed.ext : ".html";
  // A product/version name such as "页面-V1.3" does not have a file
  // extension. Keep the dotted version intact and append the canonical HTML
  // extension at the single export boundary.
  const stem = (hasHtmlExtension ? parsed.name : name) || "HTML";
  return { stem, extension };
}

export function normalizeHtmlExportPath(value) {
  const resolved = path.resolve(value);
  return [".html", ".htm"].includes(path.extname(resolved).toLowerCase())
    ? resolved
    : `${resolved}.html`;
}

export async function createSafeExportDefaultPath({
  directoryPath,
  suggestedName,
  sourcePath,
  activePath,
  platform = process.platform,
  lstatFile = lstat,
  statFile = stat,
}) {
  const { stem, extension } = exportNameParts(suggestedName);
  const protectedPaths = [sourcePath, activePath].filter(Boolean);
  for (let index = 1; index <= 1_000; index += 1) {
    const suffix = index === 1 ? "-副本" : `-副本-${index}`;
    const candidate = path.join(directoryPath, `${stem}${suffix}${extension}`);
    const protectedDestination = await isProtectedExportDestination(
      candidate,
      protectedPaths,
      {
        platform,
        statFile,
      },
    );
    if (protectedDestination) continue;
    try {
      await lstatFile(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new ProjectFileError(
    "NO_SAFE_EXPORT_NAME",
    "无法为 HTML 副本生成安全文件名，请选择其他文件夹。",
  );
}

export async function selectExportDestination({
  defaultPath,
  protectedPaths,
  showSaveDialog,
  showProtectedWarning,
  normalizeDestination = (value) => path.resolve(value),
  platform = process.platform,
  statFile = stat,
}) {
  while (true) {
    const result = await showSaveDialog(defaultPath);
    if (!result || result.canceled || !result.filePath) return null;

    const destinationPath = normalizeDestination(result.filePath);
    if (!await isProtectedExportDestination(destinationPath, protectedPaths, {
      platform,
      statFile,
    })) {
      return destinationPath;
    }

    if (!await showProtectedWarning(destinationPath)) return null;
  }
}
