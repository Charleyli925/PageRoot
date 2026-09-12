import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ProjectFileError, writeHtmlCopy } from "./project-files.mjs";
import { readLastExportDirectory, recordLastExportDirectory } from "./ui-preferences.mjs";

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

  if (
    typeof error?.code === "string"
    && error.code.startsWith("RECOVERY_JOURNAL_")
  ) {
    return {
      code: error.code,
      message: typeof error.message === "string" && error.message
        ? error.message
        : "恢复副本没有安全完成，请重试。",
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
  const roots = [...new Set((options.protectedRoots || []).filter(Boolean))];
  if (!roots.length) return false;
  const destination = await canonicalDestination(destinationPath);
  for (const root of roots) {
    if (insideRoot(destinationPath, root, options.platform)
      || insideRoot(destination, await canonicalDestination(root), options.platform)) return true;
  }
  const information = await stat(destinationPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (information?.isFile() && information.nlink > 1) {
    for (const root of roots) {
      if (await containsFileIdentity(root, information)) return true;
    }
  }
  return false;
}

function insideRoot(filePath, rootPath, platform = process.platform) {
  const relative = path.relative(normalizedPathKey(rootPath, platform), normalizedPathKey(filePath, platform));
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function canonicalDestination(filePath) {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(filePath);
    if (parent === filePath) throw error;
    return path.join(await canonicalDestination(parent), path.basename(filePath));
  }
}

async function containsFileIdentity(directory, identity) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await containsFileIdentity(entryPath, identity)) return true;
    } else if (entry.isFile()) {
      const information = await lstat(entryPath).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (information?.isFile() && information.dev === identity.dev && information.ino === identity.ino) return true;
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
  protectedRoots = [],
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
        protectedRoots,
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
  normalizeDestination = (value) => path.resolve(value),
  platform = process.platform,
  statFile = stat,
  protectedRoots = [],
}) {
  const result = await showSaveDialog(defaultPath);
  if (!result || result.canceled || !result.filePath) return null;

  const destinationPath = normalizeDestination(result.filePath);
  if (!await isProtectedExportDestination(destinationPath, protectedPaths, {
    platform,
    statFile,
    protectedRoots,
  })) {
    return destinationPath;
  }

  throw new ProjectFileError(
    "EXPORT_OVER_SOURCE",
    "无法导出到源文件或项目文件夹内，请选择其他位置。",
  );
}

export async function exportHtmlCopyToFile({
  html, sourcePath, activePath, suggestedName, projectsRoot, downloadsDirectory,
  userDataPath, showSaveDialog, normalizeDestination = normalizeHtmlExportPath,
  maxHtmlBytes, writeCopy = writeHtmlCopy,
}) {
  const protectedPaths = [sourcePath, activePath].filter(Boolean);
  const protectedRoots = [projectsRoot].filter(Boolean);
  const protection = { protectedRoots };
  const remembered = await readLastExportDirectory({ userDataPath });
  let directoryPath = downloadsDirectory;
  if (remembered
    && await stat(remembered).then((value) => value.isDirectory(), () => false)
    && !await isProtectedExportDestination(remembered, [], protection)) directoryPath = remembered;
  const defaultPath = await createSafeExportDefaultPath({
    directoryPath,
    suggestedName: suggestedName || (sourcePath && path.basename(sourcePath))
      || (activePath && path.basename(activePath)) || "HTML.html",
    sourcePath, activePath, protectedRoots,
  });
  const destinationPath = await selectExportDestination({
    defaultPath, protectedPaths, protectedRoots, showSaveDialog, normalizeDestination,
  });
  if (!destinationPath) return null;
  const assertDestination = async (target) => {
    if (await isProtectedExportDestination(target, protectedPaths, protection)) {
      throw new ProjectFileError("EXPORT_OVER_SOURCE", "导出位置刚刚发生变化，源文件没有被改动。请重新选择位置。");
    }
  };
  await assertDestination(destinationPath);
  const exported = await writeCopy({ destinationPath, html, maxHtmlBytes, assertDestination });
  // Remember only an acknowledged export. Preference failure cannot turn a
  // verified external copy into an apparent failed export or duplicate retry.
  await recordLastExportDirectory({ userDataPath, directoryPath: path.dirname(exported.path) }).catch(() => {});
  return { ...exported, exported: true };
}

export function createExportRevealAccess() {
  const exportedPaths = new Set();
  return {
    record(receipt) {
      if (receipt?.exported !== true || !path.isAbsolute(receipt.path || "")) return;
      const key = normalizedPathKey(receipt.path);
      exportedPaths.delete(key);
      exportedPaths.add(key);
      if (exportedPaths.size > 32) exportedPaths.delete(exportedPaths.values().next().value);
    },
    allows(sourcePath) {
      return typeof sourcePath === "string" && exportedPaths.has(normalizedPathKey(sourcePath));
    },
  };
}
