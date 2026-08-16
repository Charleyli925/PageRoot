import {
  lstat,
  realpath,
} from "node:fs/promises";
import path from "node:path";

const MAX_IMPORTED_ASSET_ROOTS = 32;
const MAX_PATH_LENGTH = 4096;

function assertAbsolutePath(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.length > MAX_PATH_LENGTH
    || value.includes("\0")
  ) {
    throw new TypeError(`${label}无效。`);
  }
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved)) {
    throw new TypeError(`${label}无效。`);
  }
  return resolved;
}

function normalizeImportedAssetRootEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  try {
    const projectRootPath = assertAbsolutePath(entry.projectRootPath, "projectRootPath");
    const originalSourcePath = assertAbsolutePath(
      entry.originalSourcePath,
      "originalSourcePath",
    );
    if (projectRootPath === originalSourcePath) return null;
    return Object.freeze({ projectRootPath, originalSourcePath });
  } catch {
    return null;
  }
}

export function normalizeImportedAssetRoots(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const roots = [];
  for (const entry of value) {
    const normalized = normalizeImportedAssetRootEntry(entry);
    if (!normalized || seen.has(normalized.projectRootPath)) continue;
    seen.add(normalized.projectRootPath);
    roots.push(normalized);
    if (roots.length >= MAX_IMPORTED_ASSET_ROOTS) break;
  }
  return roots;
}

export function rememberImportedAssetRoot(roots, {
  projectRootPath,
  originalSourcePath,
} = {}) {
  const nextEntry = normalizeImportedAssetRootEntry({
    projectRootPath,
    originalSourcePath,
  });
  if (!nextEntry) return Array.isArray(roots) ? roots : [];
  const retained = (Array.isArray(roots) ? roots : []).filter(
    (entry) => entry.projectRootPath !== nextEntry.projectRootPath,
  );
  return [nextEntry, ...retained].slice(0, MAX_IMPORTED_ASSET_ROOTS);
}

export async function forgetImportedAssetRootsForPath(
  roots,
  filePath,
  { realpathImpl = realpath } = {},
) {
  if (!Array.isArray(roots) || typeof filePath !== "string" || !filePath) {
    return Array.isArray(roots) ? roots : [];
  }
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const identities = new Set([resolved, directory]);
  try {
    identities.add(await realpathImpl(resolved));
  } catch {
    // The forgotten file may already be missing.
  }
  try {
    identities.add(await realpathImpl(directory));
  } catch {
    // Keep the unresolved directory identity.
  }
  return roots.filter((entry) => (
    !identities.has(entry.projectRootPath)
    && !identities.has(entry.originalSourcePath)
  ));
}

export function isExternalOriginalPath(originalPath, projectSourcePath) {
  if (typeof originalPath !== "string" || typeof projectSourcePath !== "string") {
    return false;
  }
  const original = path.resolve(originalPath);
  const projectDirectory = path.resolve(path.dirname(projectSourcePath));
  const relative = path.relative(projectDirectory, original);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

export async function importedAssetRootForProjectPath(
  roots,
  projectSourcePath,
  { realpathImpl = realpath } = {},
) {
  if (!Array.isArray(roots) || typeof projectSourcePath !== "string") return null;
  let directory = path.resolve(path.dirname(projectSourcePath));
  try {
    directory = await realpathImpl(directory);
  } catch {
    // Keep the unresolved project directory when the folder is gone.
  }
  return roots.find((entry) => entry.projectRootPath === directory) || null;
}

export function previewAssetSourcePath({
  authorizedProjectSourcePath,
  liveImportedAssetSourcePath,
} = {}) {
  if (
    typeof liveImportedAssetSourcePath === "string"
    && liveImportedAssetSourcePath
    && liveImportedAssetSourcePath !== authorizedProjectSourcePath
  ) {
    return liveImportedAssetSourcePath;
  }
  return authorizedProjectSourcePath;
}

export async function resolveLiveImportedAssetSource(
  originalSourcePath,
  { lstatImpl = lstat, realpathImpl = realpath } = {},
) {
  if (typeof originalSourcePath !== "string" || !originalSourcePath) return null;
  const resolved = path.resolve(originalSourcePath);
  try {
    const fileInfo = await lstatImpl(resolved);
    if (!fileInfo.isSymbolicLink() && (fileInfo.isFile() || fileInfo.isDirectory())) {
      return realpathImpl(resolved);
    }
  } catch {
    // The original HTML may already be in Trash; siblings can remain.
  }
  const directory = path.dirname(resolved);
  try {
    const directoryInfo = await lstatImpl(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) return null;
    return realpathImpl(directory);
  } catch {
    return null;
  }
}
