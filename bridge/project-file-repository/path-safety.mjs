// Managed-path containment, real-path verification and project-scoped I/O.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  atomicWriteFile,
  ensureDirectory,
  jsonText,
  requireCompleteHtml,
  sha256,
  syncDirectory,
} from "../lifecycle-core.mjs";

import {
  MAX_HTML_BYTES,
  SHA256,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";

export const serialPathCache = new AsyncLocalStorage();

export async function cachedRealPath(target) {
  const store = serialPathCache.getStore();
  if (store?.realPaths.has(target)) return store.realPaths.get(target);
  const resolved = await realpath(target);
  store?.realPaths.set(target, resolved);
  return resolved;
}

export async function verifiedProjectRoot(projectRoot, { allowMissing = true } = {}) {
  const store = serialPathCache.getStore();
  const cached = store?.verifiedRoots.get(projectRoot);
  if (cached) return cached;

  const rootInformation = await lstat(projectRoot).catch((cause) => {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  });
  if (!rootInformation) {
    if (allowMissing) return { exists: false };
    throw new ProjectFileRepositoryError(
      "PROJECT_ROOT_NOT_FOUND",
      "The path has no project root.",
    );
  }
  if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
    throw new ProjectFileRepositoryError(
      "UNSAFE_DIRECTORY",
      "The project root must be a real directory.",
    );
  }
  const verified = {
    exists: true,
    information: rootInformation,
    realRoot: await cachedRealPath(projectRoot),
  };
  store?.verifiedRoots.set(projectRoot, verified);
  return verified;
}

export function defaultProjectsRoot() {
  return path.join(os.homedir(), "Documents", "PageRoot", "项目");
}

export function nowIso(clock) {
  return new Date(clock()).toISOString();
}

export function previewSnippet(value, maxLength = 500) {
  return String(value || "").replaceAll("\0", "").slice(0, maxLength);
}

export function normalizedPath(value) {
  const resolved = path.resolve(String(value || "")).normalize("NFC");
  // macOS exposes the same temporary volume through both /var and
  // /private/var (and likewise /tmp). Finder, realpath(), Electron and a
  // bridge child can legitimately report different spellings for one inode.
  // Normalize the spelling before any registry, containment or identity
  // comparison so a managed Working Copy is not mistaken for a duplicate
  // project immediately after import.
  if (process.platform === "darwin") {
    if (resolved === "/private/var" || resolved.startsWith("/private/var/")) {
      return resolved.slice("/private".length);
    }
    if (resolved === "/private/tmp" || resolved.startsWith("/private/tmp/")) {
      return resolved.slice("/private".length);
    }
  }
  return resolved;
}

export function samePath(left, right) {
  const first = normalizedPath(left);
  const second = normalizedPath(right);
  if (process.platform === "darwin" || process.platform === "win32") {
    return first.toLocaleLowerCase("en-US")
      === second.toLocaleLowerCase("en-US");
  }
  return first === second;
}

export function pathInside(root, candidate, { allowRoot = false } = {}) {
  const resolvedRoot = normalizedPath(root);
  const resolvedCandidate = normalizedPath(candidate);
  const comparableRoot = process.platform === "darwin" || process.platform === "win32"
    ? resolvedRoot.toLocaleLowerCase("en-US")
    : resolvedRoot;
  const comparableCandidate = process.platform === "darwin" || process.platform === "win32"
    ? resolvedCandidate.toLocaleLowerCase("en-US")
    : resolvedCandidate;
  if (allowRoot && comparableRoot === comparableCandidate) return true;
  return comparableCandidate.startsWith(`${comparableRoot}${path.sep}`);
}

// A lexical `..` check is only the first half of managed-path validation. A
// user can otherwise replace any intermediate directory with a symlink after
// the manifest has been written and redirect a later save outside the project.
// Walk every existing component with lstat(), then compare its resolved real
// path to the resolved project root before doing a managed read or write.

// A lexical `..` check is only the first half of managed-path validation. A
// user can otherwise replace any intermediate directory with a symlink after
// the manifest has been written and redirect a later save outside the project.
// Walk every existing component with lstat(), then compare its resolved real
// path to the resolved project root before doing a managed read or write.
export async function assertRealPathInsideProject(root, candidate, label, {
  allowMissing = true,
  expectedKind = null,
} = {}) {
  const projectRoot = normalizedPath(root);
  const target = normalizedPath(candidate);
  if (!pathInside(projectRoot, target, { allowRoot: true })) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its project.`,
    );
  }
  const verified = await verifiedProjectRoot(projectRoot, { allowMissing });
  if (!verified.exists) return { exists: false, path: target };
  const { information: rootInformation, realRoot } = verified;
  const relative = path.relative(projectRoot, target);
  const parts = relative === "" ? [] : relative.split(path.sep);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its project.`,
    );
  }

  let current = projectRoot;
  let information = rootInformation;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      information = await lstat(current);
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
      if (!allowMissing) return null;
      const parentRealPath = await cachedRealPath(path.dirname(current));
      if (!pathInside(realRoot, parentRealPath, { allowRoot: true })) {
        throw new ProjectFileRepositoryError(
          "PATH_ESCAPES_PROJECT",
          `${label} escapes its project through an unsafe parent.`,
        );
      }
      return { exists: false, path: target };
    }
    if (information.isSymbolicLink()) {
      throw new ProjectFileRepositoryError(
        "PATH_ESCAPES_PROJECT",
        `${label} reaches a symbolic link inside its project.`,
      );
    }
    if (index < parts.length - 1 && !information.isDirectory()) {
      throw new ProjectFileRepositoryError(
        "UNSAFE_DIRECTORY",
        `${label} has a non-directory parent.`,
      );
    }
    const realCurrent = await cachedRealPath(current);
    if (!pathInside(realRoot, realCurrent, { allowRoot: true })) {
      throw new ProjectFileRepositoryError(
        "PATH_ESCAPES_PROJECT",
        `${label} escapes its project through an unsafe path.`,
      );
    }
  }
  if (expectedKind === "file" && !information.isFile()) {
    throw new ProjectFileRepositoryError("UNSAFE_FILE", `${label} must be a regular file.`);
  }
  if (expectedKind === "directory" && !information.isDirectory()) {
    throw new ProjectFileRepositoryError("UNSAFE_DIRECTORY", `${label} must be a real directory.`);
  }
  return { exists: true, path: target, information };
}

export function ensureRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new ProjectFileRepositoryError(
      "INVALID_RELATIVE_PATH",
      `${label} is invalid.`,
    );
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RELATIVE_PATH",
      `${label} must stay inside its project.`,
    );
  }
  return normalized;
}

export function resolveRelative(root, relativePath, label) {
  const relative = ensureRelativePath(relativePath, label);
  const resolved = path.resolve(root, ...relative.split("/"));
  if (!pathInside(root, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its project.`,
    );
  }
  return resolved;
}

export function utf8ByteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

export function truncateUtf8(value, maxBytes) {
  const normalized = String(value || "").normalize("NFC");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return "";
  let result = "";
  for (const character of normalized) {
    if (utf8ByteLength(result + character) > maxBytes) break;
    result += character;
  }
  return result.trim();
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function copyFileIdentity(information) {
  return {
    device: String(information.dev),
    inode: String(information.ino),
    birthtimeMs: Number(information.birthtimeMs || 0),
  };
}

export function assertFileIdentity(value, label) {
  if (
    !isObject(value)
    || !String(value.device || "")
    || !String(value.inode || "")
    || !Number.isFinite(Number(value.birthtimeMs))
    || Number(value.birthtimeMs) < 0
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_FILE_IDENTITY",
      label + " is invalid.",
    );
  }
  return {
    device: String(value.device),
    inode: String(value.inode),
    birthtimeMs: Number(value.birthtimeMs),
  };
}

export function sameFileIdentity(left, right) {
  return Boolean(
    left
    && right
    && String(left.device) !== "0"
    && String(left.device) === String(right.device)
    && String(left.inode) !== "0"
    && String(left.inode) === String(right.inode)
    && (
      !Number(left.birthtimeMs)
      || !Number(right.birthtimeMs)
      || Number(left.birthtimeMs) === Number(right.birthtimeMs)
    ),
  );
}

export function assertSha256(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA256.test(normalized)) {
    throw new ProjectFileRepositoryError(
      "INVALID_SHA256",
      `${label} must use sha256:<64 hex characters>.`,
    );
  }
  return normalized;
}

export function assertId(value, pattern, label) {
  const normalized = String(value || "");
  if (!pattern.test(normalized)) {
    throw new ProjectFileRepositoryError("INVALID_ID", `${label} is invalid.`);
  }
  return normalized;
}

export function decodeHtml(buffer, label) {
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_ENCODING",
      `${label} must be valid UTF-8.`,
    );
  }
  try {
    requireCompleteHtml(html, label);
  } catch (cause) {
    throw new ProjectFileRepositoryError(
      "INCOMPLETE_HTML",
      cause instanceof Error ? cause.message : `${label} is incomplete.`,
    );
  }
  return html;
}

export async function regularInformation(filePath, label, { projectRootPath = null } = {}) {
  if (projectRootPath) {
    await assertRealPathInsideProject(projectRootPath, filePath, label, {
      expectedKind: "file",
    });
  }
  let information;
  try {
    information = await lstat(filePath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new ProjectFileRepositoryError(
      "UNSAFE_FILE",
      `${label} must be a regular file, not a symbolic link.`,
    );
  }
  return information;
}

export async function directoryInformation(directoryPath, label, { projectRootPath = null } = {}) {
  if (projectRootPath) {
    await assertRealPathInsideProject(projectRootPath, directoryPath, label, {
      expectedKind: "directory",
    });
  }
  let information;
  try {
    information = await lstat(directoryPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new ProjectFileRepositoryError(
      "UNSAFE_DIRECTORY",
      `${label} must be a real directory.`,
    );
  }
  return information;
}

export async function listProjectDirectory(projectRootPath, directoryPath, label) {
  const information = await directoryInformation(directoryPath, label, {
    projectRootPath,
  });
  if (!information) {
    throw new ProjectFileRepositoryError(
      "PROJECT_CONTROL_NOT_FOUND",
      `${label} was not found inside its project.`,
    );
  }
  return readdir(directoryPath, { withFileTypes: true });
}

export async function readHtmlFile(filePath, label, options = {}) {
  const information = await regularInformation(filePath, label, options);
  if (!information) {
    throw new ProjectFileRepositoryError("SOURCE_NOT_FOUND", `${label} was not found.`);
  }
  if (information.size > MAX_HTML_BYTES) {
    throw new ProjectFileRepositoryError("SOURCE_TOO_LARGE", `${label} is too large.`);
  }
  if (typeof options.beforeRead === "function") {
    await options.beforeRead({ filePath, information });
  }
  const buffer = await readFile(filePath);
  // lstat() and readFile() are separate operations. Check the bytes that were
  // actually read so a replacement between them cannot bypass the source cap.
  if (buffer.byteLength > MAX_HTML_BYTES) {
    throw new ProjectFileRepositoryError("SOURCE_TOO_LARGE", `${label} is too large.`);
  }
  const html = decodeHtml(buffer, label);
  return {
    buffer,
    html,
    sha256: sha256(buffer),
    information,
    lastModifiedAt: information.mtime.toISOString(),
  };
}

export async function readJsonFileWithSha256(filePath, label, options = {}) {
  const information = await regularInformation(filePath, label, options);
  if (!information) return null;
  let buffer;
  let value;
  try {
    buffer = await readFile(filePath);
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ProjectFileRepositoryError("INVALID_JSON", `${label} is not valid JSON.`);
  }
  if (!isObject(value)) {
    throw new ProjectFileRepositoryError("INVALID_JSON", `${label} must be an object.`);
  }
  return { value, sha256: sha256(buffer), information };
}

export async function readJsonFile(filePath, label, options = {}) {
  const result = await readJsonFileWithSha256(filePath, label, options);
  return result?.value || null;
}

export async function writeFileNoReplace(filePath, buffer, expectedSha256, label, {
  projectRootPath = null,
} = {}) {
  if (projectRootPath) {
    await assertRealPathInsideProject(projectRootPath, filePath, label);
  }
  const expected = assertSha256(expectedSha256, `${label} hash`);
  const current = await regularInformation(filePath, label, { projectRootPath });
  if (current) {
    const existing = await readFile(filePath);
    if (sha256(existing) !== expected) {
      throw new ProjectFileRepositoryError(
        "FILE_COLLISION",
        `${label} already exists with different bytes.`,
        { filePath, expectedSha256: expected, actualSha256: sha256(existing) },
      );
    }
    return { created: false, information: current };
  }

  const parent = path.dirname(filePath);
  if (projectRootPath) {
    await assertRealPathInsideProject(projectRootPath, parent, `${label} parent`);
  }
  await ensureDirectory(parent);
  if (projectRootPath) {
    await assertRealPathInsideProject(projectRootPath, parent, `${label} parent`, {
      expectedKind: "directory",
    });
  }
  const temporary = path.join(
    parent,
    `.pageroot-new-${process.pid}-${randomUUID()}.tmp`,
  );
  await atomicWriteFile(temporary, buffer);
  try {
    try {
      await link(temporary, filePath);
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
  const information = await regularInformation(filePath, label, { projectRootPath });
  const existing = await readFile(filePath);
  if (!information || sha256(existing) !== expected) {
    throw new ProjectFileRepositoryError(
      "FILE_COLLISION",
      `${label} was replaced while being published.`,
    );
  }
  await syncDirectory(parent);
  return { created: true, information };
}

export async function readRegularFileWithSha256(filePath, label, options = {}) {
  const information = await regularInformation(filePath, label, options);
  if (!information) return null;
  const buffer = await readFile(filePath);
  return { buffer, information, sha256: sha256(buffer) };
}

export async function linkFileNoReplace(sourcePath, filePath, expectedSha256, label, {
  projectRootPath = null,
} = {}) {
  if (projectRootPath) {
    await assertRealPathInsideProject(projectRootPath, sourcePath, `${label} source`);
    await assertRealPathInsideProject(projectRootPath, filePath, label);
    await assertRealPathInsideProject(
      projectRootPath,
      path.dirname(filePath),
      `${label} parent`,
      { expectedKind: "directory" },
    );
  }
  const expected = assertSha256(expectedSha256, `${label} hash`);
  const source = await readRegularFileWithSha256(sourcePath, `${label} source`, {
    projectRootPath,
  });
  if (!source) {
    throw new ProjectFileRepositoryError(
      "SOURCE_NOT_FOUND",
      `${label} source was not found.`,
      { sourcePath },
    );
  }
  if (source.sha256 !== expected) {
    throw new ProjectFileRepositoryError(
      "FILE_COLLISION",
      `${label} source no longer has its expected bytes.`,
      { sourcePath, expectedSha256: expected, actualSha256: source.sha256 },
    );
  }
  let created = false;
  try {
    await link(sourcePath, filePath);
    created = true;
  } catch (cause) {
    if (cause?.code !== "EEXIST") throw cause;
  }
  const published = await readRegularFileWithSha256(filePath, label, {
    projectRootPath,
  });
  if (!published || published.sha256 !== expected) {
    throw new ProjectFileRepositoryError(
      "FILE_COLLISION",
      `${label} was occupied or replaced while being published.`,
      {
        filePath,
        expectedSha256: expected,
        actualSha256: published?.sha256 || null,
      },
    );
  }
  await syncDirectory(path.dirname(filePath));
  return { created, information: published.information };
}

export async function atomicWriteProjectFile(projectRootPath, filePath, content, label) {
  await assertRealPathInsideProject(
    projectRootPath,
    path.dirname(filePath),
    `${label} parent`,
    { expectedKind: "directory" },
  );
  await atomicWriteFile(filePath, content);
}

export async function atomicWriteProjectJson(projectRootPath, filePath, value, label) {
  await atomicWriteProjectFile(
    projectRootPath,
    filePath,
    jsonText(value),
    label,
  );
}

export async function ensureProjectDirectory(projectRootPath, directoryPath, label) {
  await assertRealPathInsideProject(projectRootPath, directoryPath, label);
  await ensureDirectory(directoryPath);
  await assertRealPathInsideProject(projectRootPath, directoryPath, label, {
    expectedKind: "directory",
  });
}

export function projectControlRoot(projectRootPath) {
  return path.join(projectRootPath, ".pageroot");
}

export function projectPaths(projectRootPath) {
  const controlRoot = projectControlRoot(projectRootPath);
  return {
    projectRootPath,
    controlRoot,
    projectPath: path.join(controlRoot, "project.json"),
    manifestPath: path.join(controlRoot, "manifest.json"),
    runtimePath: path.join(controlRoot, "runtime-state.json"),
    versionsRoot: path.join(controlRoot, "versions"),
    workingCopiesRoot: path.join(controlRoot, "working-copies"),
    draftsRoot: path.join(controlRoot, "drafts"),
    requestsRoot: path.join(controlRoot, "requests"),
    transactionsRoot: path.join(controlRoot, "transactions"),
    recoveryRoot: path.join(controlRoot, "recovery"),
  };
}

export function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function validStateTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
