import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  realpath,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  atomicWriteFile,
  ensureDirectory,
  exists,
  jsonText,
  requireCompleteHtml,
  sha256,
  syncDirectory,
} from "./lifecycle-core.mjs";
import {
  activeDraftSnapshot,
  applyDraftCommand,
} from "./draft-service.mjs";
import { assessHtmlCandidate } from "./candidate-assessment.mjs";

export const PROJECT_FILE_SCHEMA_VERSION = "4.0.0";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const VERSION_ID = /^ver_\d{4,}$/u;
const WORKING_COPY_ID = /^work_ver_\d{4,}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const REPOSITORY_LOCK_FILE_NAME = ".pageroot-v4-repository.lock";
const REPOSITORY_LOCK_RETRY_MS = 25;
const REPOSITORY_LOCK_TIMEOUT_MS = 60_000;
const REPOSITORY_LOCK_STALE_MS = 5 * 60_000;
const FROZEN_REQUEST_RULES = `# PageRoot AI Request Rules

- Read the frozen files in input-manifest.json readOrder before editing.
- Treat the frozen HTML, project rules, annotations and change request as read-only.
- Preserve content outside the explicitly frozen targets.
- Write exactly one complete HTML document to the output path stated in PROMPT.md.
- A valid output remains a Candidate until the user explicitly adopts it.
`;

function defaultProjectsRoot() {
  return path.join(os.homedir(), "Documents", "PageRoot", "项目");
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function normalizedPath(value) {
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

function samePath(left, right) {
  const first = normalizedPath(left);
  const second = normalizedPath(right);
  // Do not infer a case-insensitive filesystem from the operating-system
  // name. macOS can use either case-sensitive or case-insensitive APFS; on a
  // case-sensitive volume `A.html` and `a.html` are different user files.
  // Exact lexical comparison is intentionally fail-closed on a differently
  // cased alias. Existing managed paths are additionally tied to their file
  // identity before they can be rebound.
  return first === second;
}

function pathInside(root, candidate, { allowRoot = false } = {}) {
  const resolvedRoot = normalizedPath(root);
  const resolvedCandidate = normalizedPath(candidate);
  if (allowRoot && resolvedRoot === resolvedCandidate) return true;
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

// A lexical `..` check is only the first half of managed-path validation. A
// user can otherwise replace any intermediate directory with a symlink after
// the manifest has been written and redirect a later save outside the project.
// Walk every existing component with lstat(), then compare its resolved real
// path to the resolved project root before doing a managed read or write.
async function assertRealPathInsideProject(root, candidate, label, {
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
  const rootInformation = await lstat(projectRoot).catch((cause) => {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  });
  if (!rootInformation) {
    if (allowMissing) return { exists: false, path: target };
    throw new ProjectFileRepositoryError(
      "PROJECT_ROOT_NOT_FOUND",
      `${label} has no project root.`,
    );
  }
  if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
    throw new ProjectFileRepositoryError(
      "UNSAFE_DIRECTORY",
      "The project root must be a real directory.",
    );
  }
  const realRoot = await realpath(projectRoot);
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
      const parentRealPath = await realpath(path.dirname(current));
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
    const realCurrent = await realpath(current);
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

function ensureRelativePath(value, label) {
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

function resolveRelative(root, relativePath, label) {
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

function htmlExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!HTML_EXTENSIONS.has(extension)) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_EXTENSION",
      "Only .html and .htm files can be managed.",
    );
  }
  return extension;
}

function safeProjectName(sourcePath) {
  const extension = htmlExtension(sourcePath);
  const sourceName = path.basename(sourcePath, extension).normalize("NFC").trim();
  const sanitized = sourceName
    .replace(/[\u0000-\u001f<>:"/\\|?*]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^\.+|\.+$/gu, "")
    .trim();
  return sanitized || "未命名项目";
}

function assertPreferredFileStem(value, label = "preferredFileStem") {
  const stem = String(value || "").normalize("NFC").trim();
  if (!stem || /[\u0000-\u001f\u007f/\\]/u.test(stem)) {
    throw new ProjectFileRepositoryError(
      "INVALID_FILE_STEM",
      label + " must be a non-empty file-name stem.",
    );
  }
  return stem;
}

function workingCopyOrdinal(value) {
  const id = assertId(value, WORKING_COPY_ID, "workingCopyId");
  return Number.parseInt(id.slice("work_ver_".length), 10);
}

function topLevelHtmlRelativePath(value, label = "sourceRelativePath") {
  const relative = ensureRelativePath(value, label);
  if (relative.includes("/")) {
    throw new ProjectFileRepositoryError(
      "INVALID_RELATIVE_PATH",
      label + " must be a top-level HTML file.",
    );
  }
  htmlExtension(relative);
  return relative;
}

function preferredNamingForWorkingCopyPath(relativePath, workingCopyIdValue) {
  const relative = topLevelHtmlRelativePath(relativePath);
  const extension = htmlExtension(relative);
  const fileName = path.basename(relative, extension).normalize("NFC");
  const ordinal = workingCopyOrdinal(workingCopyIdValue);
  const suffix = "-V" + ordinal;
  const stem = fileName.endsWith(suffix) && fileName.length > suffix.length
    ? fileName.slice(0, -suffix.length)
    : fileName;
  return {
    preferredFileStem: assertPreferredFileStem(stem),
    preferredExtension: extension,
  };
}

function visibleFileName(stem, ordinal, extension, allocationOrdinal = 0) {
  const safeStem = assertPreferredFileStem(stem);
  const safeExtension = HTML_EXTENSIONS.has(String(extension || "").toLowerCase())
    ? String(extension).toLowerCase()
    : null;
  if (!safeExtension) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_EXTENSION",
      "Only .html and .htm files can be managed.",
    );
  }
  if (!Number.isSafeInteger(allocationOrdinal) || allocationOrdinal < 0) {
    throw new ProjectFileRepositoryError(
      "INVALID_PATH_ALLOCATION",
      "The Promotion path allocation is invalid.",
    );
  }
  return safeStem + ("-V" + ordinal).repeat(allocationOrdinal + 1) + safeExtension;
}

function versionId(ordinal) {
  return `ver_${String(ordinal).padStart(4, "0")}`;
}

function workingCopyId(ordinal) {
  return `work_ver_${String(ordinal).padStart(4, "0")}`;
}

function randomId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function candidateIdForRequest(projectId, requestId) {
  return `candidate_${sha256(Buffer.from(`${projectId}:${requestId}`, "utf8"))
    .slice("sha256:".length, "sha256:".length + 32)}`;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactObjectKeys(value, keys, label, code = "INVALID_SCHEMA_RECORD") {
  if (
    !isObject(value)
    || keys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new ProjectFileRepositoryError(
      code,
      `${label} does not match its v4 schema contract.`,
    );
  }
  return value;
}

function assertObjectKeysWithOptional(value, requiredKeys, optionalKeys, label, code) {
  if (
    !isObject(value)
    || requiredKeys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => ![...requiredKeys, ...optionalKeys].includes(key))
  ) {
    throw new ProjectFileRepositoryError(
      code,
      `${label} does not match its v4 schema contract.`,
    );
  }
  return value;
}

function assertTimestamp(value, label, code = "INVALID_SCHEMA_RECORD") {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new ProjectFileRepositoryError(code, `${label} must be an RFC 3339 timestamp.`);
  }
  return value;
}

function copyFileIdentity(information) {
  return {
    device: String(information.dev),
    inode: String(information.ino),
    birthtimeMs: Number(information.birthtimeMs || 0),
  };
}

function assertFileIdentity(value, label) {
  if (
    !isObject(value)
    || Object.keys(value).some((key) => !["device", "inode", "birthtimeMs"].includes(key))
    || !Object.hasOwn(value, "device")
    || !Object.hasOwn(value, "inode")
    || !Object.hasOwn(value, "birthtimeMs")
    || typeof value.device !== "string"
    || !value.device
    || typeof value.inode !== "string"
    || !value.inode
    || typeof value.birthtimeMs !== "number"
    || !Number.isFinite(value.birthtimeMs)
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
    birthtimeMs: value.birthtimeMs,
  };
}

function requestInputFileRecord(relativePath, role, mediaType, buffer) {
  return {
    path: String(relativePath).split(path.sep).join("/"),
    role,
    mediaType,
    byteLength: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

function sameFileIdentity(left, right) {
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

function assertSha256(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA256.test(normalized)) {
    throw new ProjectFileRepositoryError(
      "INVALID_SHA256",
      `${label} must use sha256:<64 hex characters>.`,
    );
  }
  return normalized;
}

function assertId(value, pattern, label) {
  const normalized = String(value || "");
  if (!pattern.test(normalized)) {
    throw new ProjectFileRepositoryError("INVALID_ID", `${label} is invalid.`);
  }
  return normalized;
}

function decodeHtml(buffer, label) {
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

async function regularInformation(filePath, label, { projectRootPath = null } = {}) {
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

async function directoryInformation(directoryPath, label, { projectRootPath = null } = {}) {
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

async function listProjectDirectory(projectRootPath, directoryPath, label) {
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

async function readHtmlFile(filePath, label, options = {}) {
  const information = await regularInformation(filePath, label, options);
  if (!information) {
    throw new ProjectFileRepositoryError("SOURCE_NOT_FOUND", `${label} was not found.`);
  }
  if (information.size > MAX_HTML_BYTES) {
    throw new ProjectFileRepositoryError("SOURCE_TOO_LARGE", `${label} is too large.`);
  }
  const buffer = await readFile(filePath);
  const html = decodeHtml(buffer, label);
  return {
    buffer,
    html,
    sha256: sha256(buffer),
    information,
    lastModifiedAt: information.mtime.toISOString(),
  };
}

async function readJsonFileWithSha256(filePath, label, options = {}) {
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

async function readJsonFile(filePath, label, options = {}) {
  const result = await readJsonFileWithSha256(filePath, label, options);
  return result?.value || null;
}

async function writeFileNoReplace(filePath, buffer, expectedSha256, label, {
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

async function atomicWriteProjectFile(projectRootPath, filePath, content, label) {
  await assertRealPathInsideProject(projectRootPath, filePath, label);
  await assertRealPathInsideProject(
    projectRootPath,
    path.dirname(filePath),
    `${label} parent`,
  );
  await atomicWriteFile(filePath, content);
  await assertRealPathInsideProject(projectRootPath, filePath, label, {
    expectedKind: "file",
  });
}

async function atomicWriteProjectJson(projectRootPath, filePath, value, label) {
  await atomicWriteProjectFile(
    projectRootPath,
    filePath,
    jsonText(value),
    label,
  );
}

async function ensureProjectDirectory(projectRootPath, directoryPath, label) {
  await assertRealPathInsideProject(projectRootPath, directoryPath, label);
  await ensureDirectory(directoryPath);
  await assertRealPathInsideProject(projectRootPath, directoryPath, label, {
    expectedKind: "directory",
  });
}

function projectControlRoot(projectRootPath) {
  return path.join(projectRootPath, ".pageroot");
}

function projectPaths(projectRootPath) {
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

function saveTransactionArtifactPaths(paths, transactionPath, transaction) {
  const stem = path.basename(transactionPath, ".json");
  if (!stem.startsWith("save_")) {
    throw new ProjectFileRepositoryError(
      "SAVE_TRANSACTION_INVALID",
      "The Working Copy save transaction path is invalid.",
    );
  }
  const sourceGuardRelativePath = `transactions/${stem}.source-before.html`;
  const sourceReplacementRelativePath = `transactions/${stem}.replacement.html`;
  if (
    transaction.sourceGuardRelativePath !== sourceGuardRelativePath
    || transaction.sourceReplacementRelativePath !== sourceReplacementRelativePath
  ) {
    throw new ProjectFileRepositoryError(
      "SAVE_TRANSACTION_INVALID",
      "The Working Copy save transaction artifacts are invalid.",
    );
  }
  const sourceGuardPath = resolveRelative(
    paths.controlRoot,
    sourceGuardRelativePath,
    "save source guard path",
  );
  const sourceReplacementPath = resolveRelative(
    paths.controlRoot,
    sourceReplacementRelativePath,
    "save source replacement path",
  );
  if (
    !pathInside(paths.transactionsRoot, sourceGuardPath)
    || !pathInside(paths.transactionsRoot, sourceReplacementPath)
  ) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Save transaction artifacts must stay inside transactions/.",
    );
  }
  return {
    sourceGuardRelativePath,
    sourceGuardPath,
    sourceReplacementRelativePath,
    sourceReplacementPath,
  };
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
    return true;
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
}

function emptyRegistry(clock) {
  return {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    updatedAt: nowIso(clock),
    projects: {},
    pendingImports: {},
  };
}

function assertRegistryTimestamp(value, label) {
  return assertTimestamp(value, label, "INVALID_REGISTRY");
}

function assertRegistryProjectRecord(projectId, record) {
  if (
    !isObject(record)
    || Object.keys(record).some((key) => ![
      "registeredProjectRootPath",
      "rootFileIdentity",
      "updatedAt",
    ].includes(key))
    || typeof record.registeredProjectRootPath !== "string"
    || !path.isAbsolute(record.registeredProjectRootPath)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The registered project root record is invalid.",
      { projectId },
    );
  }
  assertFileIdentity(record.rootFileIdentity, "registered rootFileIdentity");
  assertRegistryTimestamp(record.updatedAt, "registered root updatedAt");
  return record;
}

function assertPendingImportRecord(projectId, record) {
  if (
    !isObject(record)
    || Object.keys(record).some((key) => ![
      "projectId",
      "documentId",
      "registeredProjectRootPath",
      "createdAt",
    ].includes(key))
    || record.projectId !== projectId
    || typeof record.registeredProjectRootPath !== "string"
    || !path.isAbsolute(record.registeredProjectRootPath)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The pending import record is invalid.",
      { projectId },
    );
  }
  assertId(record.projectId, PROJECT_ID, "pending import projectId");
  assertId(record.documentId, DOCUMENT_ID, "pending import documentId");
  assertRegistryTimestamp(record.createdAt, "pending import createdAt");
  return record;
}

function assertRegistry(registry) {
  if (
    !isObject(registry)
    || Object.keys(registry).some((key) => ![
      "schemaVersion",
      "updatedAt",
      "projects",
      "pendingImports",
    ].includes(key))
    || !["schemaVersion", "updatedAt", "projects", "pendingImports"].every(
      (key) => Object.hasOwn(registry, key),
    )
    || registry.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || !isObject(registry.projects)
    || !isObject(registry.pendingImports)
  ) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_REGISTRY_SCHEMA",
      "The project Registry uses an unsupported schema.",
    );
  }
  assertRegistryTimestamp(registry.updatedAt, "Registry updatedAt");
  for (const [projectId, record] of Object.entries(registry.projects)) {
    assertId(projectId, PROJECT_ID, "Registry projectId");
    assertRegistryProjectRecord(projectId, record);
  }
  for (const [projectId, record] of Object.entries(registry.pendingImports)) {
    assertId(projectId, PROJECT_ID, "pending import projectId");
    assertPendingImportRecord(projectId, record);
  }
  return registry;
}

function assertProjectIdentity(project) {
  if (
    !isObject(project)
    || Object.keys(project).some((key) => ![
      "schemaVersion",
      "projectId",
      "documentId",
      "createdAt",
    ].includes(key))
    || !["schemaVersion", "projectId", "documentId", "createdAt"].every(
      (key) => Object.hasOwn(project, key),
    )
    || project.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
  ) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_PROJECT_SCHEMA",
      "project.json is not a supported PageRoot project identity.",
    );
  }
  assertId(project.projectId, PROJECT_ID, "projectId");
  assertId(project.documentId, DOCUMENT_ID, "documentId");
  assertTimestamp(project.createdAt, "project.json createdAt", "INVALID_PROJECT_IDENTITY");
  return project;
}

function assertManifestVersionEntry(version) {
  assertExactObjectKeys(version, [
    "versionId",
    "ordinal",
    "basedOnVersionId",
    "previousVersionId",
    "contentSha256",
    "snapshotRelativePath",
    "sourceRequestId",
    "sourceCandidateId",
    "createdAt",
  ], "A Version entry", "INVALID_MANIFEST");
  assertId(version.versionId, VERSION_ID, "versionId");
  if (
    !Number.isSafeInteger(version.ordinal)
    || version.ordinal < 1
    || version.versionId !== versionId(version.ordinal)
    || !SHA256.test(String(version.contentSha256 || ""))
    || ![null, "string"].includes(
      version.sourceRequestId === null ? null : typeof version.sourceRequestId,
    )
    || ![null, "string"].includes(
      version.sourceCandidateId === null ? null : typeof version.sourceCandidateId,
    )
  ) {
    throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Version entry is inconsistent.");
  }
  if (version.basedOnVersionId !== null) {
    assertId(version.basedOnVersionId, VERSION_ID, "basedOnVersionId");
  }
  if (version.previousVersionId !== null) {
    assertId(version.previousVersionId, VERSION_ID, "previousVersionId");
  }
  ensureRelativePath(version.snapshotRelativePath, "snapshotRelativePath");
  assertTimestamp(version.createdAt, "Version createdAt", "INVALID_MANIFEST");
  return version;
}

function assertManifestWorkingCopyEntry(workingCopy) {
  assertExactObjectKeys(workingCopy, [
    "workingCopyId",
    "versionId",
    "basedOnVersionId",
    "sourceRelativePath",
    "preferredFileStem",
    "preferredExtension",
    "stateRelativePath",
    "fileIdentity",
  ], "A Working Copy entry", "INVALID_MANIFEST");
  assertId(workingCopy.workingCopyId, WORKING_COPY_ID, "workingCopyId");
  assertId(workingCopy.versionId, VERSION_ID, "versionId");
  assertId(workingCopy.basedOnVersionId, VERSION_ID, "basedOnVersionId");
  const sourceRelativePath = topLevelHtmlRelativePath(
    workingCopy.sourceRelativePath,
    "sourceRelativePath",
  );
  assertPreferredFileStem(workingCopy.preferredFileStem);
  if (!HTML_EXTENSIONS.has(workingCopy.preferredExtension)) {
    throw new ProjectFileRepositoryError(
      "INVALID_MANIFEST",
      "A Working Copy preferred extension is invalid.",
    );
  }
  const stateRelativePath = ensureRelativePath(
    workingCopy.stateRelativePath,
    "stateRelativePath",
  );
  if (!stateRelativePath.startsWith("working-copies/") || !stateRelativePath.endsWith(".json")) {
    throw new ProjectFileRepositoryError(
      "INVALID_MANIFEST",
      "A Working Copy state path is invalid.",
    );
  }
  assertFileIdentity(workingCopy.fileIdentity, "Working Copy fileIdentity");
  return { workingCopy, sourceRelativePath };
}

function assertManifest(manifest, project) {
  if (
    !isObject(manifest)
    || Object.keys(manifest).some((key) => ![
      "schemaVersion",
      "projectId",
      "documentId",
      "latestOfficialVersionId",
      "versions",
      "workingCopies",
    ].includes(key))
    || ![
      "schemaVersion",
      "projectId",
      "documentId",
      "latestOfficialVersionId",
      "versions",
      "workingCopies",
    ].every((key) => Object.hasOwn(manifest, key))
    || manifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
  ) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_MANIFEST_SCHEMA",
      "manifest.json is not a supported PageRoot manifest.",
    );
  }
  if (
    manifest.projectId !== project.projectId
    || manifest.documentId !== project.documentId
    || !Array.isArray(manifest.versions)
    || !Array.isArray(manifest.workingCopies)
    || manifest.versions.length === 0
    || manifest.workingCopies.length === 0
  ) {
    throw new ProjectFileRepositoryError(
      "MANIFEST_IDENTITY_MISMATCH",
      "manifest.json does not match project.json.",
    );
  }
  const versionIds = new Set();
  const versionOrdinals = new Set();
  for (const version of manifest.versions) {
    assertManifestVersionEntry(version);
    if (
      versionIds.has(version.versionId)
      || versionOrdinals.has(version.ordinal)
    ) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Version entry is inconsistent.");
    }
    versionIds.add(version.versionId);
    versionOrdinals.add(version.ordinal);
  }
  if (!versionIds.has(manifest.latestOfficialVersionId)) {
    throw new ProjectFileRepositoryError("INVALID_MANIFEST", "latestOfficialVersionId is unknown.");
  }
  const workingCopyIds = new Set();
  const workingCopyPaths = new Set();
  for (const workingCopy of manifest.workingCopies) {
    const { sourceRelativePath } = assertManifestWorkingCopyEntry(workingCopy);
    if (
      workingCopyIds.has(workingCopy.workingCopyId)
      || !versionIds.has(workingCopy.basedOnVersionId)
      || !versionIds.has(workingCopy.versionId)
    ) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Working Copy entry is inconsistent.");
    }
    if (workingCopyPaths.has(sourceRelativePath)) {
      throw new ProjectFileRepositoryError(
        "INVALID_MANIFEST",
        "Working Copy source paths must be unique.",
      );
    }
    workingCopyPaths.add(sourceRelativePath);
    workingCopyIds.add(workingCopy.workingCopyId);
  }
  return manifest;
}

function assertRuntime(runtime, project, manifest) {
  if (
    !isObject(runtime)
    || Object.keys(runtime).some((key) => ![
      "schemaVersion",
      "projectId",
      "documentId",
      "activeWorkingCopyId",
      "activeRequest",
      "activeCandidateId",
    ].includes(key))
    || ![
      "schemaVersion",
      "projectId",
      "documentId",
      "activeWorkingCopyId",
      "activeRequest",
      "activeCandidateId",
    ].every((key) => Object.hasOwn(runtime, key))
    || runtime.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
  ) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_RUNTIME_SCHEMA",
      "runtime-state.json is not a supported PageRoot runtime state.",
    );
  }
  if (runtime.projectId !== project.projectId || runtime.documentId !== project.documentId) {
    throw new ProjectFileRepositoryError(
      "RUNTIME_IDENTITY_MISMATCH",
      "runtime-state.json does not match project.json.",
    );
  }
  if (
    runtime.activeWorkingCopyId !== null
    && (
      !WORKING_COPY_ID.test(String(runtime.activeWorkingCopyId || ""))
      || !manifest.workingCopies.some(
        (workingCopy) => workingCopy.workingCopyId === runtime.activeWorkingCopyId,
      )
    )
  ) {
    throw new ProjectFileRepositoryError("INVALID_RUNTIME", "activeWorkingCopyId is unknown.");
  }
  if (runtime.activeCandidateId !== null) assertCandidateId(runtime.activeCandidateId);
  if (runtime.activeRequest !== null) {
    const active = runtime.activeRequest;
    if (
      !isObject(active)
      || Object.keys(active).some((key) => ![
        "requestId",
        "candidateId",
        "attemptId",
        "status",
        "inputManifestSha256",
        "candidateOutputSha256",
        "candidateRecordSha256",
      ].includes(key))
      || ![
        "requestId",
        "candidateId",
        "attemptId",
        "status",
        "inputManifestSha256",
        "candidateOutputSha256",
        "candidateRecordSha256",
      ].every((key) => Object.hasOwn(active, key))
      || !SAFE_REQUEST_ID.test(active.requestId)
      || !SAFE_REQUEST_ID.test(active.attemptId)
      || !["processing", "pending-review"].includes(active.status)
      || (active.candidateId !== null && !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(active.candidateId))
      || (
        active.inputManifestSha256 !== null
        && !SHA256.test(String(active.inputManifestSha256 || ""))
      )
      || (
        active.candidateOutputSha256 !== null
        && !SHA256.test(String(active.candidateOutputSha256 || ""))
      )
      || (
        active.candidateRecordSha256 !== null
        && !SHA256.test(String(active.candidateRecordSha256 || ""))
      )
      || (active.status === "processing" && !SHA256.test(String(active.inputManifestSha256 || "")))
      || (
        active.status === "processing"
        && (
          active.candidateId !== null
          || active.candidateOutputSha256 !== null
          || active.candidateRecordSha256 !== null
        )
      )
      || (
        active.status === "pending-review"
        && (
          active.candidateId !== runtime.activeCandidateId
          || !SHA256.test(String(active.candidateOutputSha256 || ""))
          || !SHA256.test(String(active.candidateRecordSha256 || ""))
        )
      )
    ) {
      throw new ProjectFileRepositoryError("INVALID_RUNTIME", "active Request is inconsistent.");
    }
  }
  return runtime;
}

function workingCopyStatePath(paths, workingCopy) {
  const relative = ensureRelativePath(workingCopy.stateRelativePath, "stateRelativePath");
  const resolved = resolveRelative(paths.controlRoot, relative, "stateRelativePath");
  if (!pathInside(paths.workingCopiesRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Working Copy state must stay inside working-copies/.",
    );
  }
  return resolved;
}

function draftRelativePathFor(workingCopy) {
  return `drafts/${workingCopy.workingCopyId}.json`;
}

function draftPathForState(paths, workingCopy, state = {}) {
  const relative = state?.draftRelativePath || draftRelativePathFor(workingCopy);
  const resolved = resolveRelative(paths.controlRoot, relative, "draftRelativePath");
  if (!pathInside(paths.draftsRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Working Copy draft must stay inside drafts/.",
    );
  }
  return resolved;
}

function workingCopySourcePath(paths, workingCopy) {
  const relative = topLevelHtmlRelativePath(
    workingCopy.sourceRelativePath,
    "sourceRelativePath",
  );
  const resolved = resolveRelative(paths.projectRootPath, relative, "sourceRelativePath");
  if (pathInside(paths.controlRoot, resolved, { allowRoot: true })) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "A visible Working Copy cannot be inside .pageroot.",
    );
  }
  return resolved;
}

function versionSnapshotPath(paths, version) {
  const relative = ensureRelativePath(version.snapshotRelativePath, "snapshotRelativePath");
  const resolved = resolveRelative(paths.controlRoot, relative, "snapshotRelativePath");
  if (!pathInside(paths.versionsRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "A Version snapshot must stay inside versions/.",
    );
  }
  return resolved;
}

function publicOpenTarget({
  project,
  projectRootPath,
  targetKind,
  workingCopy = null,
  version = null,
  exactSourcePath,
  sourceSha256,
}) {
  return Object.freeze({
    projectId: project.projectId,
    documentId: project.documentId,
    projectRootPath,
    targetKind,
    workingCopyId: workingCopy?.workingCopyId || null,
    versionId: version?.versionId || workingCopy?.versionId || null,
    exactSourcePath,
    sourceSha256,
  });
}

function requestRootPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  return path.join(paths.requestsRoot, id);
}

function frozenRequestRelativePaths(requestId, attemptId) {
  const id = String(requestId || "");
  const attempt = String(attemptId || "");
  if (!SAFE_REQUEST_ID.test(id) || !SAFE_REQUEST_ID.test(attempt)) {
    throw new ProjectFileRepositoryError(
      "INVALID_REQUEST_ID",
      "A frozen Request path has an invalid identity.",
    );
  }
  const root = `requests/${id}`;
  return {
    inputRelativePath: `${root}/input/base/index.html`,
    promptRelativePath: `${root}/PROMPT.md`,
    projectRulesRelativePath: `${root}/input/PROJECT.md`,
    annotationsRelativePath: `${root}/input/annotations/records.json`,
    changeRequestRelativePath: `${root}/change-request.json`,
    inputManifestRelativePath: `${root}/input-manifest.json`,
    outputRelativePath: `${root}/attempts/${attempt}/output/candidate.html`,
  };
}

function assertCandidateId(value) {
  const id = String(value || "");
  if (!/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_CANDIDATE_ID", "candidateId is invalid.");
  }
  return id;
}

function assessedCandidate(baseHtml, outputHtml, clock) {
  const assessment = {
    ...assessHtmlCandidate({ baseHtml, outputHtml }),
    assessedAt: nowIso(clock),
  };
  if (assessment.status === "blocked") {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_UNUSABLE",
      "The Candidate HTML could not be safely adopted.",
      { issueCodes: assessment.issueCodes },
    );
  }
  return assessment;
}

function assertCandidateAssessment(assessment) {
  const requiredContinuityKeys = [
    "status",
    "evidencePoints",
    "sameTitle",
    "text",
    "anchors",
    "classes",
    "assets",
    "baseVisibleTextLength",
    "outputVisibleTextLength",
    "baseBodyElementCount",
    "outputBodyElementCount",
    "baseParseErrorCount",
    "outputParseErrorCount",
  ];
  const assertOverlap = (overlap) => {
    assertExactObjectKeys(overlap, ["score", "shared", "base", "output"], "Candidate overlap", "CANDIDATE_VALIDATION_INVALID");
    if (
      !(overlap.score === null || (typeof overlap.score === "number" && overlap.score >= 0 && overlap.score <= 1))
      || ![overlap.shared, overlap.base, overlap.output].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    ) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_VALIDATION_INVALID",
        "Candidate overlap evidence is invalid.",
      );
    }
  };
  if (
    !isObject(assessment)
    || Object.keys(assessment).some((key) => ![
      "schemaVersion",
      "status",
      "issueCodes",
      "health",
      "continuity",
      "assessedAt",
    ].includes(key))
    || ![
      "schemaVersion",
      "status",
      "issueCodes",
      "health",
      "continuity",
      "assessedAt",
    ].every((key) => Object.hasOwn(assessment, key))
    || assessment.schemaVersion !== "1.0.0"
    || !["ready", "attention"].includes(assessment.status)
    || !Array.isArray(assessment.issueCodes)
    || assessment.issueCodes.some((value) => typeof value !== "string" || !value)
    || new Set(assessment.issueCodes).size !== assessment.issueCodes.length
    || !isObject(assessment.health)
    || Object.keys(assessment.health).some((key) => ![
      "completeDocument",
      "bodyHasContent",
    ].includes(key))
    || !["completeDocument", "bodyHasContent"].every(
      (key) => Object.hasOwn(assessment.health, key),
    )
    || typeof assessment.health.completeDocument !== "boolean"
    || typeof assessment.health.bodyHasContent !== "boolean"
    || !isObject(assessment.continuity)
    || Object.keys(assessment.continuity).some(
      (key) => !requiredContinuityKeys.includes(key),
    )
    || !requiredContinuityKeys.every((key) => Object.hasOwn(assessment.continuity, key))
    || !["related", "uncertain"].includes(assessment.continuity.status)
    || !Number.isSafeInteger(assessment.continuity.evidencePoints)
    || assessment.continuity.evidencePoints < 0
    || typeof assessment.continuity.sameTitle !== "boolean"
    || ![
      assessment.continuity.baseVisibleTextLength,
      assessment.continuity.outputVisibleTextLength,
      assessment.continuity.baseBodyElementCount,
      assessment.continuity.outputBodyElementCount,
      assessment.continuity.baseParseErrorCount,
      assessment.continuity.outputParseErrorCount,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_VALIDATION_INVALID",
      "Candidate validation evidence is invalid.",
    );
  }
  for (const key of ["text", "anchors", "classes", "assets"]) {
    assertOverlap(assessment.continuity[key]);
  }
  assertTimestamp(assessment.assessedAt, "Candidate assessedAt", "CANDIDATE_VALIDATION_INVALID");
  return assessment;
}

function assertWorkingCopyState(state, project, workingCopy) {
  assertExactObjectKeys(state, [
    "schemaVersion",
    "projectId",
    "documentId",
    "workingCopyId",
    "basedOnVersionId",
    "baseSha256",
    "currentSha256",
    "differsFromBase",
    "draftId",
    "draftRelativePath",
    "draftSha256",
    "draftRevision",
    "saveState",
    "lastPersistedRevision",
    "lastSavedAt",
    "lastOpenedAt",
  ], "Working Copy state", "INVALID_WORKING_COPY_STATE");
  if (
    state.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || state.projectId !== project.projectId
    || state.documentId !== project.documentId
    || state.workingCopyId !== workingCopy.workingCopyId
    || state.basedOnVersionId !== workingCopy.basedOnVersionId
    || !SHA256.test(String(state.baseSha256 || ""))
    || !SHA256.test(String(state.currentSha256 || ""))
    || typeof state.differsFromBase !== "boolean"
    || state.differsFromBase !== (state.currentSha256 !== state.baseSha256)
    || typeof state.draftId !== "string"
    || !state.draftId
    || state.draftRelativePath !== draftRelativePathFor(workingCopy)
    || (state.draftSha256 !== null && !SHA256.test(String(state.draftSha256 || "")))
    || !Number.isSafeInteger(state.draftRevision)
    || state.draftRevision < 0
    || !["saved", "saving", "failed"].includes(state.saveState)
    || !Number.isSafeInteger(state.lastPersistedRevision)
    || state.lastPersistedRevision < 0
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_WORKING_COPY_STATE",
      "Working Copy state does not match its v4 schema contract.",
    );
  }
  assertTimestamp(state.lastSavedAt, "Working Copy lastSavedAt", "INVALID_WORKING_COPY_STATE");
  assertTimestamp(state.lastOpenedAt, "Working Copy lastOpenedAt", "INVALID_WORKING_COPY_STATE");
  return state;
}

function assertCandidateRecord(candidate, loaded) {
  assertObjectKeysWithOptional(candidate, [
    "schemaVersion",
    "candidateId",
    "projectId",
    "documentId",
    "requestId",
    "attemptId",
    "proposedVersionId",
    "proposedVersionOrdinal",
    "basedOnVersionId",
    "previousVersionId",
    "sourceWorkingCopyId",
    "expectedSourceSha256",
    "outputRelativePath",
    "outputSha256",
    "assessment",
    "status",
    "createdAt",
  ], ["rejectedAt", "promotedAt", "promotedVersionId"], "Candidate", "INVALID_CANDIDATE");
  if (
    candidate.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || candidate.projectId !== loaded.project.projectId
    || candidate.documentId !== loaded.project.documentId
    || !SAFE_REQUEST_ID.test(String(candidate.requestId || ""))
    || !SAFE_REQUEST_ID.test(String(candidate.attemptId || ""))
    || !Number.isSafeInteger(candidate.proposedVersionOrdinal)
    || candidate.proposedVersionOrdinal < 2
    || candidate.proposedVersionId !== versionId(candidate.proposedVersionOrdinal)
    || candidate.outputRelativePath !== `requests/${candidate.requestId}/candidate.html`
    || !SHA256.test(String(candidate.expectedSourceSha256 || ""))
    || !SHA256.test(String(candidate.outputSha256 || ""))
    || !["pending-review", "rejected", "promoted"].includes(candidate.status)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_CANDIDATE",
      "Candidate does not match its v4 schema contract.",
    );
  }
  assertCandidateId(candidate.candidateId);
  assertId(candidate.proposedVersionId, VERSION_ID, "Candidate proposedVersionId");
  assertId(candidate.basedOnVersionId, VERSION_ID, "Candidate basedOnVersionId");
  assertId(candidate.previousVersionId, VERSION_ID, "Candidate previousVersionId");
  assertId(candidate.sourceWorkingCopyId, WORKING_COPY_ID, "Candidate sourceWorkingCopyId");
  assertCandidateAssessment(candidate.assessment);
  assertTimestamp(candidate.createdAt, "Candidate createdAt", "INVALID_CANDIDATE");
  if (Object.hasOwn(candidate, "rejectedAt")) {
    assertTimestamp(candidate.rejectedAt, "Candidate rejectedAt", "INVALID_CANDIDATE");
  }
  if (Object.hasOwn(candidate, "promotedAt")) {
    assertTimestamp(candidate.promotedAt, "Candidate promotedAt", "INVALID_CANDIDATE");
  }
  if (Object.hasOwn(candidate, "promotedVersionId")) {
    assertId(candidate.promotedVersionId, VERSION_ID, "Candidate promotedVersionId");
  }
  if (candidate.status === "rejected" && !Object.hasOwn(candidate, "rejectedAt")) {
    throw new ProjectFileRepositoryError("INVALID_CANDIDATE", "Rejected Candidate lacks rejectedAt.");
  }
  if (
    candidate.status === "promoted"
    && (!Object.hasOwn(candidate, "promotedAt") || candidate.promotedVersionId !== candidate.proposedVersionId)
  ) {
    throw new ProjectFileRepositoryError("INVALID_CANDIDATE", "Promoted Candidate lacks its Version identity.");
  }
  return candidate;
}

function assertPromotionTransaction(transaction) {
  assertObjectKeysWithOptional(transaction, [
    "schemaVersion",
    "kind",
    "state",
    "transactionId",
    "projectId",
    "documentId",
    "candidateId",
    "requestId",
    "versionId",
    "versionOrdinal",
    "candidateOutputSha256",
    "basedOnVersionId",
    "previousVersionId",
    "finalWorkingCopyRelativePath",
    "preparedWorkingCopyRelativePath",
    "preferredFileStem",
    "preferredExtension",
    "pathAllocationOrdinal",
    "preparedWorkingCopyFileIdentity",
    "workingCopy",
    "createdAt",
  ], [
    "snapshotCreatedAt",
    "reallocatedAt",
    "workingCopyPreparedAt",
    "workingCopyCreatedAt",
    "manifestCommittedAt",
    "completedAt",
  ], "Promotion transaction", "PROMOTION_TRANSACTION_INVALID");
  if (
    transaction.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || transaction.kind !== "promotion"
    || ![
      "prepared",
      "snapshot-created",
      "working-copy-prepared",
      "working-copy-created",
      "manifest-committed",
      "completed",
    ].includes(transaction.state)
    || !SAFE_REQUEST_ID.test(String(transaction.requestId || ""))
    || !Number.isSafeInteger(transaction.versionOrdinal)
    || transaction.versionOrdinal < 2
    || transaction.versionId !== versionId(transaction.versionOrdinal)
    || transaction.transactionId !== `promote_${transaction.candidateId}`
    || !SHA256.test(String(transaction.candidateOutputSha256 || ""))
    || !Number.isSafeInteger(transaction.pathAllocationOrdinal)
    || transaction.pathAllocationOrdinal < 0
  ) {
    throw new ProjectFileRepositoryError(
      "PROMOTION_TRANSACTION_INVALID",
      "Promotion transaction does not match its v4 schema contract.",
    );
  }
  assertCandidateId(transaction.candidateId);
  assertId(transaction.projectId, PROJECT_ID, "Promotion projectId");
  assertId(transaction.documentId, DOCUMENT_ID, "Promotion documentId");
  assertId(transaction.versionId, VERSION_ID, "Promotion versionId");
  assertId(transaction.basedOnVersionId, VERSION_ID, "Promotion basedOnVersionId");
  assertId(transaction.previousVersionId, VERSION_ID, "Promotion previousVersionId");
  topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath);
  assertPreferredFileStem(transaction.preferredFileStem);
  if (!HTML_EXTENSIONS.has(transaction.preferredExtension)) {
    throw new ProjectFileRepositoryError(
      "PROMOTION_TRANSACTION_INVALID",
      "The Promotion preferred extension is invalid.",
    );
  }
  if (
    transaction.preparedWorkingCopyRelativePath
      !== `transactions/${transaction.transactionId}/prepared-working-copy${transaction.preferredExtension}`
  ) {
    throw new ProjectFileRepositoryError(
      "PROMOTION_TRANSACTION_INVALID",
      "The Promotion prepared Working Copy path is invalid.",
    );
  }
  if (transaction.preparedWorkingCopyFileIdentity !== null) {
    assertFileIdentity(
      transaction.preparedWorkingCopyFileIdentity,
      "Promotion prepared Working Copy fileIdentity",
    );
  }
  if (transaction.workingCopy !== null) {
    assertManifestWorkingCopyEntry(transaction.workingCopy);
  }
  for (const key of [
    "createdAt",
    "snapshotCreatedAt",
    "reallocatedAt",
    "workingCopyPreparedAt",
    "workingCopyCreatedAt",
    "manifestCommittedAt",
    "completedAt",
  ]) {
    if (Object.hasOwn(transaction, key)) {
      assertTimestamp(transaction[key], `Promotion ${key}`, "PROMOTION_TRANSACTION_INVALID");
    }
  }
  return transaction;
}

function assertPromotionCandidateBinding(transaction, candidate) {
  if (
    transaction.projectId !== candidate.projectId
    || transaction.documentId !== candidate.documentId
    || transaction.candidateId !== candidate.candidateId
    || transaction.requestId !== candidate.requestId
    || transaction.versionId !== candidate.proposedVersionId
    || transaction.versionOrdinal !== candidate.proposedVersionOrdinal
    || transaction.candidateOutputSha256 !== candidate.outputSha256
    || transaction.basedOnVersionId !== candidate.basedOnVersionId
    || transaction.previousVersionId !== candidate.previousVersionId
  ) {
    throw new ProjectFileRepositoryError(
      "PROMOTION_TRANSACTION_MISMATCH",
      "The Promotion transaction no longer matches its sealed Candidate identity.",
    );
  }
}

export class ProjectFileRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectFileRepositoryError";
    this.code = code;
    this.details = details;
  }
}

function invalidRegisteredProjectError(cause) {
  return cause instanceof ProjectFileRepositoryError
    && new Set([
      "REGISTERED_PROJECT_IDENTITY_CHANGED",
      "REGISTERED_PROJECT_UNAVAILABLE",
      "PROJECT_IDENTITY_CHANGED",
      "UNREGISTERED_PROJECT_ROOT",
      "PROJECT_ROOT_NOT_FOUND",
      "PROJECT_CONTROL_NOT_FOUND",
      "UNSUPPORTED_PROJECT_SCHEMA",
      "INVALID_PROJECT_IDENTITY",
      "UNSUPPORTED_MANIFEST_SCHEMA",
      "MANIFEST_IDENTITY_MISMATCH",
      "INVALID_MANIFEST",
      "UNSUPPORTED_RUNTIME_SCHEMA",
      "RUNTIME_IDENTITY_MISMATCH",
      "INVALID_RUNTIME",
      "INVALID_JSON",
    ]).has(cause.code);
}

// This is a persistence repository, not a runtime Store. Sessions keep the
// mutable UI facts; the repository only resolves and atomically records the
// on-disk facts specified by VERSION_AND_PROJECT_FILES_PRD.md.
export class ProjectFileRepository {
  #projectsRoot;

  #registryPath;

  #clock;

  #failpoint;

  #tail = Promise.resolve();

  constructor({
    projectsRoot = defaultProjectsRoot(),
    registryPath = path.join(projectsRoot, ".pageroot-registry.json"),
    clock = Date.now,
    failpoint = null,
  } = {}) {
    this.#projectsRoot = normalizedPath(projectsRoot);
    this.#registryPath = normalizedPath(registryPath);
    this.#clock = typeof clock === "function" ? clock : Date.now;
    this.#failpoint = typeof failpoint === "function" ? failpoint : null;
  }

  get projectsRoot() {
    return this.#projectsRoot;
  }

  async initialize() {
    return this.#serial(async () => {
      await ensureDirectory(this.#projectsRoot);
      await this.#assertProjectsRoot();
      if (!(await exists(this.#registryPath))) {
        await atomicWriteProjectJson(
          this.#projectsRoot,
          this.#registryPath,
          emptyRegistry(this.#clock),
          "project registry",
        );
      }
      await this.#recoverPublishedImports();
    });
  }

  async importExternal({
    sourcePath,
    expectedSourceSha256 = null,
  } = {}) {
    return this.#serial(() => this.#importExternal({
      sourcePath,
      expectedSourceSha256,
    }));
  }

  async resolveOpenTarget({ sourcePath } = {}) {
    return this.#serial(() => this.#resolveOpenTarget({ sourcePath }));
  }

  async saveWorkingCopy({
    target,
    html,
    expectedSourceSha256,
    editRevision = 0,
  } = {}) {
    return this.#serial(() => this.#saveWorkingCopy({
      target,
      html,
      expectedSourceSha256,
      editRevision,
    }));
  }

  async createCandidate({
    target,
    requestId,
    attemptId = "attempt_001",
    candidateId = null,
    html,
    expectedSourceSha256,
  } = {}) {
    // Kept as a compatibility convenience for callers that formerly used
    // createCandidate(). It is now strictly a completion of an already
    // frozen Request; it can never create a Candidate without the immutable
    // Request bundle and its runtime manifest seal.
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const requestPath = path.join(
        requestRootPath(loaded.paths, requestId),
        "request.json",
      );
      const request = await readJsonFile(requestPath, "request.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!request) {
        throw new ProjectFileRepositoryError(
          "REQUEST_REQUIRED",
          "Candidate creation requires a frozen processing Request.",
        );
      }
      this.#assertRequestRecord(request, loaded, { requestId, attemptId });
      if (
        expectedSourceSha256 !== undefined
        && expectedSourceSha256 !== null
        && assertSha256(expectedSourceSha256, "expectedSourceSha256")
          !== request.expectedSourceSha256
      ) {
        throw new ProjectFileRepositoryError(
          "REQUEST_SOURCE_MISMATCH",
          "Candidate creation must use the frozen Request source hash.",
        );
      }
      if (candidateId !== null && candidateId !== request.candidateId) {
        throw new ProjectFileRepositoryError(
          "REQUEST_CANDIDATE_MISMATCH",
          "Candidate creation must use the frozen Request Candidate id.",
        );
      }
      const completed = await this.#completeRequest({
        target,
        requestId,
        attemptId,
        html,
      });
      if (!completed.candidate) {
        if (completed.request?.error?.code) {
          throw new ProjectFileRepositoryError(
            completed.request.error.code,
            completed.request.error.message || "The Candidate could not be prepared.",
            { issueCodes: completed.request.error.issueCodes || [] },
          );
        }
        throw new ProjectFileRepositoryError(
          "CANDIDATE_NOT_CREATED",
          "The Request completed without an adoptable Candidate.",
        );
      }
      const refreshed = await this.#resolveMutationTarget(target);
      return this.#readCandidateForLoaded(refreshed, completed.candidate.candidateId);
    });
  }

  async rejectCandidate({ target, candidateId } = {}) {
    return this.#serial(() => this.#rejectCandidate({ target, candidateId }));
  }

  async promoteCandidate({ target, candidateId } = {}) {
    return this.#serial(() => this.#promoteCandidate({ target, candidateId }));
  }

  async recoverProject({ projectRootPath } = {}) {
    return this.#serial(() => this.#recoverProject(projectRootPath));
  }

  async workspace({ sourcePath } = {}) {
    return this.#serial(() => this.#workspace({ sourcePath }));
  }

  async prepareRequest({
    target,
    requestId,
    attemptId = "attempt_001",
    expectedSourceSha256,
    request = {},
    prompt = "",
  } = {}) {
    return this.#serial(() => this.#prepareRequest({
      target,
      requestId,
      attemptId,
      expectedSourceSha256,
      request,
      prompt,
    }));
  }

  async completeRequest({
    target,
    requestId,
    attemptId = "attempt_001",
    html,
  } = {}) {
    return this.#serial(() => this.#completeRequest({
      target,
      requestId,
      attemptId,
      html,
    }));
  }

  async requestStatus({ target, requestId, attemptId = "attempt_001" } = {}) {
    return this.#serial(() => this.#requestStatus({ target, requestId, attemptId }));
  }

  async cancelRequest({ target, requestId, attemptId = "attempt_001" } = {}) {
    return this.#serial(() => this.#cancelRequest({ target, requestId, attemptId }));
  }

  async saveDraft({
    target,
    operationId,
    expectedDraftRevision,
    basedOnVersionId,
    comments,
    changeEvents,
    deletedCommentIds,
  } = {}) {
    return this.#serial(() => this.#saveDraft({
      target,
      operationId,
      expectedDraftRevision,
      basedOnVersionId,
      comments,
      changeEvents,
      deletedCommentIds,
    }));
  }

  async readVersionFile({ target, versionId: requestedVersionId } = {}) {
    return this.#serial(() => this.#readVersionFile({ target, requestedVersionId }));
  }

  async readCandidate({ target, candidateId: requestedCandidateId } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const result = await this.#readCandidateForLoaded(loaded, requestedCandidateId);
      return {
        candidate: structuredClone(result.candidate),
        content: result.output.html,
        sha256: result.output.sha256,
      };
    });
  }

  async readProjectNotes({ target } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const filePath = path.join(loaded.paths.projectRootPath, "PROJECT.md");
      const information = await regularInformation(filePath, "PROJECT.md", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!information) {
        throw new ProjectFileRepositoryError(
          "PROJECT_FILE_NOT_FOUND",
          "PROJECT.md was not found.",
        );
      }
      const buffer = await readFile(filePath);
      return {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        path: filePath,
        content: buffer.toString("utf8"),
        sha256: sha256(buffer),
        updatedAt: information.mtime.toISOString(),
      };
    });
  }

  async updateProjectNotes({ target, content, expectedSha256 } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      if (typeof content !== "string" || !content.trim()) {
        throw new ProjectFileRepositoryError(
          "INVALID_PROJECT_FILE",
          "PROJECT.md must be non-empty Markdown.",
        );
      }
      const filePath = path.join(loaded.paths.projectRootPath, "PROJECT.md");
      const information = await regularInformation(filePath, "PROJECT.md", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!information) {
        throw new ProjectFileRepositoryError(
          "PROJECT_FILE_NOT_FOUND",
          "PROJECT.md was not found.",
        );
      }
      const expected = assertSha256(expectedSha256, "expected PROJECT.md sha256");
      const previous = await readFile(filePath);
      const actual = sha256(previous);
      if (actual !== expected) {
        throw new ProjectFileRepositoryError(
          "PROJECT_FILE_CONFLICT",
          "PROJECT.md changed outside PageRoot before this edit could be saved.",
          { expectedSha256: expected, actualSha256: actual },
        );
      }
      const next = Buffer.from(content, "utf8");
      const updated = !previous.equals(next);
      if (updated) {
        await this.#hit("project-notes-before-write", { filePath });
        const immediatelyBeforeWrite = await readFile(filePath);
        const immediatelyBeforeWriteSha256 = sha256(immediatelyBeforeWrite);
        if (immediatelyBeforeWriteSha256 !== expected) {
          throw new ProjectFileRepositoryError(
            "PROJECT_FILE_CONFLICT",
            "PROJECT.md changed outside PageRoot before publication.",
            {
              expectedSha256: expected,
              actualSha256: immediatelyBeforeWriteSha256,
            },
          );
        }
        await atomicWriteProjectFile(
          loaded.paths.projectRootPath,
          filePath,
          next,
          "PROJECT.md",
        );
      }
      return {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        path: filePath,
        content,
        sha256: sha256(next),
        updated,
      };
    });
  }

  async #serial(operation) {
    const run = () => this.#withSharedMutationLock(operation);
    const current = this.#tail.then(run, run);
    this.#tail = current.catch(() => {});
    return current;
  }

  async #withSharedMutationLock(operation) {
    await ensureDirectory(this.#projectsRoot);
    await this.#assertProjectsRoot();
    const lockPath = path.join(this.#projectsRoot, REPOSITORY_LOCK_FILE_NAME);
    const deadline = Date.now() + REPOSITORY_LOCK_TIMEOUT_MS;
    let handle = null;
    let identity = null;
    while (!handle) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        const information = await lstat(lockPath);
        if (information.isSymbolicLink() || !information.isFile()) {
          throw new ProjectFileRepositoryError(
            "UNSAFE_REPOSITORY_LOCK",
            "The shared PageRoot repository lock is not a regular file.",
          );
        }
        identity = copyFileIdentity(information);
        await handle.writeFile(jsonText({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }));
        await handle.sync();
        await this.#hit("repository-lock-acquired", { lockPath });
      } catch (cause) {
        if (handle) {
          await handle.close().catch(() => {});
          handle = null;
          if (identity) {
            const information = await lstat(lockPath).catch((error) => {
              if (error?.code === "ENOENT") return null;
              throw error;
            });
            if (information && sameFileIdentity(identity, copyFileIdentity(information))) {
              await unlink(lockPath).catch(() => {});
              await syncDirectory(this.#projectsRoot);
            }
          }
          identity = null;
          throw cause;
        }
        if (cause?.code !== "EEXIST") throw cause;
        const information = await lstat(lockPath).catch((error) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        });
        if (!information) continue;
        if (information.isSymbolicLink() || !information.isFile()) {
          throw new ProjectFileRepositoryError(
            "UNSAFE_REPOSITORY_LOCK",
            "The shared PageRoot repository lock is not a regular file.",
          );
        }
        const age = Date.now() - Number(information.mtimeMs || 0);
        if (age >= REPOSITORY_LOCK_STALE_MS) {
          let ownerPid = null;
          try {
            const owner = JSON.parse(await readFile(lockPath, "utf8"));
            if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) ownerPid = owner.pid;
          } catch {
            // An expired malformed lock has no live owner we can verify.
          }
          let ownerIsAlive = false;
          if (ownerPid !== null) {
            try {
              process.kill(ownerPid, 0);
              ownerIsAlive = true;
            } catch (error) {
              ownerIsAlive = error?.code !== "ESRCH";
            }
          }
          if (!ownerIsAlive) {
            const beforeRemoval = copyFileIdentity(information);
            const latest = await lstat(lockPath).catch((error) => {
              if (error?.code === "ENOENT") return null;
              throw error;
            });
            if (latest && sameFileIdentity(beforeRemoval, copyFileIdentity(latest))) {
              await unlink(lockPath).catch((error) => {
                if (error?.code !== "ENOENT") throw error;
              });
              await syncDirectory(this.#projectsRoot);
              continue;
            }
          }
        }
        if (Date.now() >= deadline) {
          throw new ProjectFileRepositoryError(
            "REPOSITORY_LOCK_TIMEOUT",
            "Another PageRoot process is still updating this project directory.",
            { lockPath },
          );
        }
        await new Promise((resolve) => setTimeout(resolve, REPOSITORY_LOCK_RETRY_MS));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => {});
      const information = await lstat(lockPath).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      if (information && identity && sameFileIdentity(identity, copyFileIdentity(information))) {
        await unlink(lockPath).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        await syncDirectory(this.#projectsRoot);
      }
    }
  }

  async #hit(name, details = {}) {
    if (!this.#failpoint) return;
    const injected = await this.#failpoint(name, details);
    if (injected) {
      throw new ProjectFileRepositoryError(
        "INJECTED_FAILPOINT",
        `Failpoint ${name} was injected.`,
        { name, ...details },
      );
    }
  }

  async #readRegistry() {
    const registry = await readJsonFile(this.#registryPath, "project registry", {
      projectRootPath: this.#projectsRoot,
    });
    if (!registry) return emptyRegistry(this.#clock);
    return assertRegistry(registry);
  }

  async #workspace({ sourcePath }) {
    // A guarded save can temporarily remove the visible source path while its
    // private transaction record still owns the exact registered project.
    // Recover that project before trying to read the HTML, otherwise a crash
    // between staging and no-replace publication would make recovery itself
    // fail on the intentionally absent source path.
    const registered = await this.#registeredProjectForSource(sourcePath);
    if (registered) {
      await this.#recoverProject(registered.paths.projectRootPath);
    }
    let target = await this.#resolveOpenTarget({ sourcePath });
    if (!target) return null;
    // A Promotion transaction means the user already chose adoption.  Resume
    // it before exposing any workspace facts, so a crash cannot leave a
    // half-Version between Candidate review and a formal Version.
    const recovered = await this.#recoverProject(target.projectRootPath);
    if (recovered.length > 0) {
      target = await this.#resolveOpenTarget({ sourcePath });
      if (!target) return null;
    }
    const loaded = await this.#loadRegisteredProject({
      projectId: target.projectId,
      documentId: target.documentId,
      declaredProjectRootPath: target.projectRootPath,
    });
    const workingCopy = target.workingCopyId
      ? loaded.manifest.workingCopies.find(
        (entry) => entry.workingCopyId === target.workingCopyId,
      )
      : null;
    let state = workingCopy
      ? await readJsonFile(workingCopyStatePath(loaded.paths, workingCopy), "Working Copy state", {
        projectRootPath: loaded.paths.projectRootPath,
      })
      : null;
    if (workingCopy && !state) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The managed Working Copy has no v4 state record.",
      );
    }
    if (workingCopy && state) assertWorkingCopyState(state, loaded.project, workingCopy);
    let draft = workingCopy && state
      ? await this.#readTrackedDraft({ ...loaded, workingCopy, state })
      : null;
    const activeRequest = loaded.runtime.activeRequest
      ? await readJsonFile(
        path.join(
          requestRootPath(loaded.paths, loaded.runtime.activeRequest.requestId),
          "request.json",
        ),
        "active request.json",
        { projectRootPath: loaded.paths.projectRootPath },
      )
      : null;
    if (activeRequest) {
      this.#assertRequestRecord(activeRequest, { ...loaded, workingCopy }, {
        requestId: loaded.runtime.activeRequest.requestId,
        attemptId: loaded.runtime.activeRequest.attemptId,
      });
      await this.#assertSealedRequestIdentity({ ...loaded, workingCopy }, activeRequest);
    }
    const activeCandidate = (
      activeRequest?.status === "candidate-ready"
      && activeRequest.candidateId
    )
      ? await this.#readCandidateForLoaded(
        { ...loaded, workingCopy },
        activeRequest.candidateId,
      )
      : null;
    const source = await readHtmlFile(target.exactSourcePath, "managed HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    let workingCopyRecovered = false;
    if (workingCopy && state && target.targetKind === "working-copy") {
      const reconciliation = await this.#reconcileExternalWorkingCopyState({
        loaded,
        workingCopy,
        state,
        source,
      });
      state = reconciliation.state;
      workingCopyRecovered = reconciliation.recovered;
      if (workingCopyRecovered) {
        draft = await this.#readTrackedDraft({ ...loaded, workingCopy, state });
      }
    }
    return {
      target,
      project: structuredClone(loaded.project),
      manifest: structuredClone(loaded.manifest),
      runtime: structuredClone(loaded.runtime),
      workingCopy: workingCopy ? structuredClone(workingCopy) : null,
      workingCopyState: state ? structuredClone(state) : null,
      draft: draft ? structuredClone(draft) : null,
      activeRequest: activeRequest ? structuredClone(activeRequest) : null,
      activeCandidate: activeCandidate
        ? structuredClone(activeCandidate.candidate)
        : null,
      workingCopyRecovered,
      content: source.html,
      sourceSha256: source.sha256,
      lastModifiedAt: source.lastModifiedAt,
    };
  }

  async #reconcileExternalWorkingCopyState({ loaded, workingCopy, state, source }) {
    const recordedSha256 = String(state.currentSha256 || "");
    if (recordedSha256 === source.sha256) return { state, recovered: false };
    if (state.saveState !== "saved") {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_CONFLICT",
        "The Working Copy changed on disk while PageRoot still retains unsaved edits.",
        {
          workingCopyId: workingCopy.workingCopyId,
          recordedSha256,
          diskSha256: source.sha256,
          saveState: state.saveState || null,
        },
      );
    }
    const nextState = {
      ...state,
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: workingCopy.workingCopyId,
      currentSha256: source.sha256,
      differsFromBase: source.sha256 !== state.baseSha256,
      saveState: "saved",
      lastOpenedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      workingCopyStatePath(loaded.paths, workingCopy),
      nextState,
      "Working Copy state",
    );
    return { state: nextState, recovered: true };
  }

  async #readTrackedDraft({ paths, project, workingCopy, state }) {
    const draftRecord = await readJsonFileWithSha256(
      draftPathForState(paths, workingCopy, state),
      "Working Copy draft",
      { projectRootPath: paths.projectRootPath },
    );
    if (state.draftSha256 === null) {
      if (draftRecord || state.draftRevision !== 0) {
        throw new ProjectFileRepositoryError(
          "DRAFT_POINTER_MISMATCH",
          "The Working Copy draft exists without the state pointer that owns it.",
        );
      }
      return null;
    }
    const draft = draftRecord?.value || null;
    if (
      !draftRecord
      || draftRecord.sha256 !== state.draftSha256
      || !isObject(draft)
      || draft.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || draft.projectId !== project.projectId
      || draft.documentId !== project.documentId
      || draft.workingCopyId !== workingCopy.workingCopyId
      || draft.basedOnVersionId !== workingCopy.basedOnVersionId
      || !Number.isSafeInteger(draft.draftRevision)
      || draft.draftRevision !== state.draftRevision
      || !Array.isArray(draft.comments)
      || !Array.isArray(draft.changeEvents)
      || !Array.isArray(draft.deletedCommentIds)
      || !Array.isArray(draft.appliedOperationIds)
      || draft.appliedOperationIds.some((operationId) => (
        typeof operationId !== "string" || !operationId
      ))
    ) {
      throw new ProjectFileRepositoryError(
        "DRAFT_POINTER_MISMATCH",
        "The Working Copy draft does not match the durable state pointer.",
      );
    }
    assertTimestamp(draft.updatedAt, "Working Copy draft updatedAt", "DRAFT_POINTER_MISMATCH");
    return draft;
  }

  async #prepareRequest({
    target,
    requestId,
    attemptId,
    expectedSourceSha256,
    request,
    prompt,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const id = String(requestId || "");
    if (!SAFE_REQUEST_ID.test(id)) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
    }
    const attempt = String(attemptId || "attempt_001");
    if (!SAFE_REQUEST_ID.test(attempt)) {
      throw new ProjectFileRepositoryError("INVALID_ATTEMPT_ID", "attemptId is invalid.");
    }
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    if (loaded.source.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed before this Request was frozen.",
        { expectedSourceSha256: expected, actualSourceSha256: loaded.source.sha256 },
      );
    }
    const active = loaded.runtime.activeRequest;
    if (active && active.requestId !== id) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_REQUEST_EXISTS",
        "Another AI Request is still active for this Working Copy.",
        { activeRequestId: active.requestId },
      );
    }
    const requestRoot = requestRootPath(loaded.paths, id);
    const requestPath = path.join(requestRoot, "request.json");
    const existing = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (existing) {
      this.#assertRequestRecord(existing, loaded, { requestId: id, attemptId: attempt });
      await this.#assertSealedRequestIdentity(loaded, existing);
      if (existing.expectedSourceSha256 !== expected) {
        throw new ProjectFileRepositoryError(
          "REQUEST_COLLISION",
          "This Request id belongs to another frozen source state.",
        );
      }
      await this.#restoreRequestRuntime(loaded, existing);
      return this.#publicRequest(existing, loaded.paths.projectRootPath);
    }
    const latest = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const workingState = await readJsonFile(
      workingCopyStatePath(loaded.paths, loaded.workingCopy),
      "Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (!workingState) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The active Working Copy has no v4 state record.",
      );
    }
    assertWorkingCopyState(workingState, loaded.project, loaded.workingCopy);
    const frozenRequest = {
      ...(isObject(request) ? structuredClone(request) : {}),
      // The V4 protocol keeps the same source-preservation contract as V3.
      // A caller cannot weaken it while a Request is being frozen.
      preserveOutsideTargets: true,
    };
    const freezeCutoffRevision = Number(frozenRequest.freezeCutoffRevision || 0);
    if (
      !Number.isSafeInteger(freezeCutoffRevision)
      || freezeCutoffRevision < 0
      || freezeCutoffRevision > Number(workingState?.lastPersistedRevision || 0)
    ) {
      throw new ProjectFileRepositoryError(
        "FREEZE_REVISION_NOT_PERSISTED",
        "The Request freeze revision has not been durably saved to its Working Copy.",
        {
          freezeCutoffRevision,
          lastPersistedRevision: Number(workingState?.lastPersistedRevision || 0),
        },
      );
    }
    const ordinal = latest.ordinal + 1;
    const proposedVersionId = versionId(ordinal);
    const idForCandidate = candidateIdForRequest(loaded.project.projectId, id);
    const inputRoot = path.join(requestRoot, "input", "base");
    const inputPath = path.join(inputRoot, "index.html");
    const annotationsPath = path.join(requestRoot, "input", "annotations", "records.json");
    const projectRulesPath = path.join(requestRoot, "input", "PROJECT.md");
    const aiRulesPath = path.join(requestRoot, "input", "AI_RULES.md");
    const changeRequestPath = path.join(requestRoot, "change-request.json");
    const inputManifestPath = path.join(requestRoot, "input-manifest.json");
    const promptPath = path.join(requestRoot, "PROMPT.md");
    const outputRelativePath = `requests/${id}/attempts/${attempt}/output/candidate.html`;
    const outputPath = resolveRelative(
      loaded.paths.controlRoot,
      outputRelativePath,
      "request output path",
    );
    const projectNotesPath = path.join(loaded.paths.projectRootPath, "PROJECT.md");
    const projectNotes = await regularInformation(projectNotesPath, "PROJECT.md", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!projectNotes) {
      throw new ProjectFileRepositoryError(
        "PROJECT_FILE_NOT_FOUND",
        "PROJECT.md must exist before an AI Request can be frozen.",
      );
    }
    const projectNotesBuffer = await readFile(projectNotesPath);
    const promptBuffer = Buffer.from(String(prompt || ""), "utf8");
    const aiRulesBuffer = Buffer.from(FROZEN_REQUEST_RULES, "utf8");
    const annotationsBuffer = Buffer.from(jsonText({
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      requestId: id,
      attemptId: attempt,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      basedOnVersionId: loaded.workingCopy.basedOnVersionId,
      freezeCutoffRevision,
      comments: Array.isArray(frozenRequest.comments)
        ? frozenRequest.comments
        : [],
      changeEvents: Array.isArray(frozenRequest.changeEvents)
        ? frozenRequest.changeEvents
        : [],
      targets: Array.isArray(frozenRequest.targets)
        ? frozenRequest.targets
        : [],
    }), "utf8");
    const changeRequestBuffer = Buffer.from(jsonText({
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      requestId: id,
      attemptId: attempt,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      expectedSourceSha256: expected,
      proposedVersionId,
      proposedVersionOrdinal: ordinal,
      basedOnVersionId: loaded.workingCopy.basedOnVersionId,
      previousVersionId: latest.versionId,
      freezeCutoffRevision,
      requirements: frozenRequest,
    }), "utf8");
    const inputManifestRelativePath = `requests/${id}/input-manifest.json`;
    const inputManifest = {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      requestId: id,
      attemptId: attempt,
      frozen: true,
      readOrder: [
        "PROMPT.md",
        "input/AI_RULES.md",
        "change-request.json",
        "input/PROJECT.md",
        "input/base/index.html",
        "input/annotations/records.json",
      ],
      files: [
        requestInputFileRecord("PROMPT.md", "prompt", "text/markdown", promptBuffer),
        requestInputFileRecord("input/AI_RULES.md", "policy", "text/markdown", aiRulesBuffer),
        requestInputFileRecord("change-request.json", "change-request", "application/json", changeRequestBuffer),
        requestInputFileRecord("input/PROJECT.md", "project-rules", "text/markdown", projectNotesBuffer),
        requestInputFileRecord("input/base/index.html", "base-html", "text/html", loaded.source.buffer),
        requestInputFileRecord("input/annotations/records.json", "annotations", "application/json", annotationsBuffer),
      ],
    };
    const inputManifestBuffer = Buffer.from(jsonText(inputManifest), "utf8");
    const record = {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      requestId: id,
      attemptId: attempt,
      candidateId: idForCandidate,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      expectedSourceSha256: expected,
      proposedVersionId,
      proposedVersionOrdinal: ordinal,
      basedOnVersionId: loaded.workingCopy.basedOnVersionId,
      previousVersionId: latest.versionId,
      inputRelativePath: `requests/${id}/input/base/index.html`,
      promptRelativePath: `requests/${id}/PROMPT.md`,
      projectRulesRelativePath: `requests/${id}/input/PROJECT.md`,
      annotationsRelativePath: `requests/${id}/input/annotations/records.json`,
      changeRequestRelativePath: `requests/${id}/change-request.json`,
      inputManifestRelativePath,
      inputManifestSha256: sha256(inputManifestBuffer),
      outputRelativePath,
      status: "processing",
      createdAt: nowIso(this.#clock),
      request: frozenRequest,
    };
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(inputPath),
      "Request input directory",
    );
    await writeFileNoReplace(inputPath, loaded.source.buffer, expected, "Request input HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-input-written", { requestId: id, requestRoot });
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(projectRulesPath),
      "Request project rules directory",
    );
    await writeFileNoReplace(projectRulesPath, projectNotesBuffer, sha256(projectNotesBuffer), "Request project rules", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await writeFileNoReplace(aiRulesPath, aiRulesBuffer, sha256(aiRulesBuffer), "Request AI rules", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-project-rules-written", { requestId: id, requestRoot });
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(annotationsPath),
      "Request annotations directory",
    );
    await writeFileNoReplace(annotationsPath, annotationsBuffer, sha256(annotationsBuffer), "Request annotations", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-annotations-written", { requestId: id, requestRoot });
    await writeFileNoReplace(changeRequestPath, changeRequestBuffer, sha256(changeRequestBuffer), "Request change record", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-change-record-written", { requestId: id, requestRoot });
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(outputPath),
      "Request output directory",
    );
    await writeFileNoReplace(promptPath, promptBuffer, sha256(promptBuffer), "Request prompt", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-prompt-written", { requestId: id, requestRoot });
    await writeFileNoReplace(
      inputManifestPath,
      inputManifestBuffer,
      sha256(inputManifestBuffer),
      "Request input manifest",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    await this.#hit("request-input-manifest-written", { requestId: id, requestRoot });
    // Freezing the Request can span several durable writes. Re-read the
    // Working Copy at the publication boundary so a concurrent external edit
    // cannot turn the already-frozen, stale buffer into an active Request.
    const sourceBeforePublish = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (sourceBeforePublish.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed while this Request was being frozen.",
        { expectedSourceSha256: expected, actualSourceSha256: sourceBeforePublish.sha256 },
      );
    }
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      requestPath,
      record,
      "request.json",
    );
    await this.#hit("request-record-written", { requestId: id, requestRoot });
    loaded.runtime.activeRequest = {
      requestId: id,
      candidateId: null,
      attemptId: attempt,
      status: "processing",
      // The external Agent can write inside its Request tree, but this
      // Runtime anchor remains outside it. The finalizer compares this digest
      // before trusting any Request-owned manifest or frozen input.
      inputManifestSha256: record.inputManifestSha256,
      candidateOutputSha256: null,
      candidateRecordSha256: null,
    };
    loaded.runtime.activeCandidateId = null;
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.runtimePath,
      loaded.runtime,
      "runtime-state.json",
    );
    await this.#hit("request-runtime-written", { requestId: id, requestRoot });
    await this.#hit("request-prepared", { requestId: id, requestRoot });
    return this.#publicRequest(record, loaded.paths.projectRootPath);
  }

  #assertRequestRecord(record, loaded, { requestId, attemptId }) {
    if (
      !isObject(record)
      || record.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || record.requestId !== requestId
      || record.attemptId !== attemptId
      || record.projectId !== loaded.project.projectId
      || record.documentId !== loaded.project.documentId
      || record.sourceWorkingCopyId !== loaded.workingCopy.workingCopyId
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_IDENTITY_MISMATCH",
        "The frozen Request does not belong to this active Working Copy.",
      );
    }
    if (
      !isObject(record.request)
      || ![
        "processing",
        "candidate-ready",
        "no-change",
        "error",
        "promoted",
        "cancelled",
        "rejected",
      ].includes(record.status)
    ) {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST",
        "The frozen Request has an unsupported lifecycle record.",
      );
    }
    assertCandidateId(record.candidateId);
    assertSha256(record.expectedSourceSha256, "request expectedSourceSha256");
    assertId(record.proposedVersionId, VERSION_ID, "proposedVersionId");
    if (!Number.isSafeInteger(record.proposedVersionOrdinal) || record.proposedVersionOrdinal < 2) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST", "The Request Version ordinal is invalid.");
    }
    assertId(record.basedOnVersionId, VERSION_ID, "basedOnVersionId");
    assertId(record.previousVersionId, VERSION_ID, "previousVersionId");
    ensureRelativePath(record.inputRelativePath, "request input path");
    ensureRelativePath(record.outputRelativePath, "request output path");
    for (const [value, label] of [
      [record.promptRelativePath, "request prompt path"],
      [record.projectRulesRelativePath, "request project rules path"],
      [record.annotationsRelativePath, "request annotations path"],
      [record.changeRequestRelativePath, "request change record path"],
      [record.inputManifestRelativePath, "request input manifest path"],
    ]) {
      if (value !== undefined) ensureRelativePath(value, label);
    }
    assertSha256(record.inputManifestSha256, "request input manifest hash");
    assertTimestamp(record.createdAt, "Request createdAt", "INVALID_REQUEST");
    for (const key of ["completedAt", "cancelledAt", "promotedAt"]) {
      if (Object.hasOwn(record, key)) {
        assertTimestamp(record[key], `Request ${key}`, "INVALID_REQUEST");
      }
    }
  }

  async #assertSealedRequestIdentity(loaded, record) {
    const expectedPaths = frozenRequestRelativePaths(record.requestId, record.attemptId);
    if (
      record.candidateId !== candidateIdForRequest(record.projectId, record.requestId)
      || record.proposedVersionId !== versionId(record.proposedVersionOrdinal)
      || Object.entries(expectedPaths).some(([key, value]) => record[key] !== value)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_IDENTITY_MISMATCH",
        "The Request identity no longer matches its immutable path allocation.",
      );
    }
    const active = loaded.runtime.activeRequest;
    if (
      active?.requestId === record.requestId
      && (
        active.attemptId !== record.attemptId
        || active.inputManifestSha256 !== record.inputManifestSha256
      )
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request no longer matches its runtime manifest anchor.",
      );
    }
    const requestRoot = requestRootPath(loaded.paths, record.requestId);
    const manifest = await readJsonFileWithSha256(
      path.join(requestRoot, "input-manifest.json"),
      "request input manifest",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const anchor = active?.requestId === record.requestId
      ? active.inputManifestSha256
      : record.inputManifestSha256;
    if (!manifest || manifest.sha256 !== anchor) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest changed after submission.",
      );
    }
    const manifestValue = manifest.value;
    if (
      manifestValue.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || manifestValue.projectId !== record.projectId
      || manifestValue.documentId !== record.documentId
      || manifestValue.requestId !== record.requestId
      || manifestValue.attemptId !== record.attemptId
      || manifestValue.frozen !== true
      || !Array.isArray(manifestValue.files)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_IDENTITY_MISMATCH",
        "The frozen input manifest belongs to another Request identity.",
      );
    }
    const changeRecords = manifestValue.files.filter((entry) => (
      isObject(entry)
      && entry.path === "change-request.json"
      && entry.role === "change-request"
      && entry.mediaType === "application/json"
    ));
    if (
      changeRecords.length !== 1
      || !SHA256.test(String(changeRecords[0].sha256 || ""))
      || !Number.isSafeInteger(changeRecords[0].byteLength)
      || changeRecords[0].byteLength < 0
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request has no authoritative change record.",
      );
    }
    const changeRecord = await readJsonFileWithSha256(
      path.join(requestRoot, "change-request.json"),
      "frozen Request change record",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (
      !changeRecord
      || changeRecord.sha256 !== changeRecords[0].sha256
      || changeRecord.information.size !== changeRecords[0].byteLength
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request change record changed after submission.",
      );
    }
    const change = changeRecord.value;
    if (
      !isObject(change)
      || change.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || change.projectId !== record.projectId
      || change.documentId !== record.documentId
      || change.requestId !== record.requestId
      || change.attemptId !== record.attemptId
      || change.sourceWorkingCopyId !== record.sourceWorkingCopyId
      || change.expectedSourceSha256 !== record.expectedSourceSha256
      || change.proposedVersionId !== record.proposedVersionId
      || Number(change.proposedVersionOrdinal) !== Number(record.proposedVersionOrdinal)
      || change.basedOnVersionId !== record.basedOnVersionId
      || change.previousVersionId !== record.previousVersionId
      || !isObject(change.requirements)
      || jsonText(change.requirements) !== jsonText(record.request)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_IDENTITY_MISMATCH",
        "The Request no longer matches its immutable change record.",
      );
    }
  }

  #assertCompletionRecord(completion, request) {
    if (
      !isObject(completion)
      || completion.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || completion.kind !== "candidate-finalization"
      || completion.projectId !== request.projectId
      || completion.documentId !== request.documentId
      || completion.requestId !== request.requestId
      || completion.attemptId !== request.attemptId
      || completion.candidateId !== request.candidateId
      || completion.proposedVersionId !== request.proposedVersionId
      || Number(completion.proposedVersionOrdinal) !== Number(request.proposedVersionOrdinal)
      || completion.basedOnVersionId !== request.basedOnVersionId
      || completion.previousVersionId !== request.previousVersionId
      || completion.expectedSourceSha256 !== request.expectedSourceSha256
      || completion.inputManifestSha256 !== request.inputManifestSha256
      || completion.outputRelativePath !== request.outputRelativePath
      || !SHA256.test(String(completion.outputSha256 || ""))
      || !["completed", "no-change"].includes(completion.status)
      || !completion.completedAt
      || Number.isNaN(Date.parse(completion.completedAt))
    ) {
      throw new ProjectFileRepositoryError(
        "COMPLETION_IDENTITY_MISMATCH",
        "completion.json does not belong to this immutable Request.",
      );
    }
  }

  #publicRequest(record, projectRootPath) {
    return {
      requestId: record.requestId,
      attemptId: record.attemptId,
      candidateId: record.candidateId,
      projectId: record.projectId,
      documentId: record.documentId,
      sourceWorkingCopyId: record.sourceWorkingCopyId,
      expectedSourceSha256: record.expectedSourceSha256,
      proposedVersionId: record.proposedVersionId,
      proposedVersionOrdinal: record.proposedVersionOrdinal,
      basedOnVersionId: record.basedOnVersionId,
      previousVersionId: record.previousVersionId,
      status: record.status,
      createdAt: record.createdAt,
      request: structuredClone(record.request || {}),
      projectRootPath,
      requestRelativePath: `requests/${record.requestId}`,
      ...(record.promptRelativePath ? { promptRelativePath: record.promptRelativePath } : {}),
      ...(record.projectRulesRelativePath
        ? { projectRulesRelativePath: record.projectRulesRelativePath }
        : {}),
      ...(record.annotationsRelativePath
        ? { annotationsRelativePath: record.annotationsRelativePath }
        : {}),
      ...(record.changeRequestRelativePath
        ? { changeRequestRelativePath: record.changeRequestRelativePath }
        : {}),
      ...(record.inputManifestRelativePath
        ? { inputManifestRelativePath: record.inputManifestRelativePath }
        : {}),
      ...(record.inputManifestSha256
        ? { inputManifestSha256: record.inputManifestSha256 }
        : {}),
      outputRelativePath: record.outputRelativePath,
      ...(isObject(record.error) ? { error: structuredClone(record.error) } : {}),
    };
  }

  async #restoreRequestRuntime(loaded, record) {
    this.#assertRequestRecord(record, loaded, {
      requestId: record.requestId,
      attemptId: record.attemptId,
    });
    await this.#assertSealedRequestIdentity(loaded, record);
    const existingActiveRequest = loaded.runtime.activeRequest;
    if (
      existingActiveRequest?.requestId === record.requestId
      && existingActiveRequest.inputManifestSha256 !== record.inputManifestSha256
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest no longer matches runtime authority.",
      );
    }
    let status = record.status;
    let candidateId = null;
    if (status === "processing") {
      const candidatePath = path.join(
        requestRootPath(loaded.paths, record.requestId),
        "candidate.json",
      );
      const candidateRecord = await readJsonFileWithSha256(candidatePath, "candidate.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const candidate = candidateRecord?.value || null;
      if (candidate) {
        const outputPath = resolveRelative(
          loaded.paths.controlRoot,
          candidate.outputRelativePath,
          "candidate output path",
        );
        const output = await readHtmlFile(outputPath, "Candidate HTML", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (
          candidate.candidateId !== record.candidateId
          || candidate.status !== "pending-review"
          || existingActiveRequest?.requestId !== record.requestId
          || existingActiveRequest?.attemptId !== record.attemptId
          || existingActiveRequest.status !== "pending-review"
          || existingActiveRequest.candidateId !== record.candidateId
          || existingActiveRequest.candidateOutputSha256 !== output.sha256
          || existingActiveRequest.candidateRecordSha256 !== candidateRecord.sha256
        ) {
          throw new ProjectFileRepositoryError(
            "CANDIDATE_AUTHORITY_MISMATCH",
            "A Candidate exists without the runtime authority required for review.",
          );
        }
        record.status = "candidate-ready";
        record.completedAt = record.completedAt || nowIso(this.#clock);
        await atomicWriteProjectJson(
          loaded.paths.projectRootPath,
          path.join(requestRootPath(loaded.paths, record.requestId), "request.json"),
          record,
          "request.json",
        );
        status = record.status;
      }
    }
    let candidateOutputSha256 = null;
    let candidateRecordSha256 = null;
    if (status === "candidate-ready") {
      candidateId = record.candidateId;
      const candidateState = await this.#readCandidateForLoaded(loaded, candidateId);
      candidateOutputSha256 = candidateState.output.sha256;
      candidateRecordSha256 = candidateState.candidateRecordSha256;
      if (
        existingActiveRequest?.requestId !== record.requestId
        || existingActiveRequest?.attemptId !== record.attemptId
        || existingActiveRequest.status !== "pending-review"
        || existingActiveRequest.candidateId !== candidateId
        || existingActiveRequest.candidateOutputSha256 !== candidateOutputSha256
        || existingActiveRequest.candidateRecordSha256 !== candidateRecordSha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "A Candidate-ready Request is missing its sealed runtime authority.",
        );
      }
    } else if (status !== "processing") {
      if (loaded.runtime.activeRequest?.requestId === record.requestId) {
        loaded.runtime.activeRequest = null;
        loaded.runtime.activeCandidateId = null;
        await atomicWriteProjectJson(
          loaded.paths.projectRootPath,
          loaded.paths.runtimePath,
          loaded.runtime,
          "runtime-state.json",
        );
      }
      return false;
    }
    const nextActiveRequest = {
      requestId: record.requestId,
      candidateId,
      attemptId: record.attemptId,
      status: candidateId ? "pending-review" : "processing",
      inputManifestSha256: record.inputManifestSha256,
      candidateOutputSha256,
      candidateRecordSha256,
    };
    const active = loaded.runtime.activeRequest;
    if (
      active?.requestId !== nextActiveRequest.requestId
      || active?.attemptId !== nextActiveRequest.attemptId
      || active?.candidateId !== nextActiveRequest.candidateId
      || active?.status !== nextActiveRequest.status
      || active?.inputManifestSha256 !== nextActiveRequest.inputManifestSha256
      || active?.candidateOutputSha256 !== nextActiveRequest.candidateOutputSha256
      || active?.candidateRecordSha256 !== nextActiveRequest.candidateRecordSha256
      || loaded.runtime.activeCandidateId !== candidateId
    ) {
      loaded.runtime.activeRequest = nextActiveRequest;
      loaded.runtime.activeCandidateId = candidateId;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.runtimePath,
        loaded.runtime,
        "runtime-state.json",
      );
      return true;
    }
    return false;
  }

  async #requestStatus({ target, requestId, attemptId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const record = await readJsonFile(path.join(requestRoot, "request.json"), "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
    if (["processing", "candidate-ready"].includes(record.status)) {
      await this.#assertSealedRequestIdentity(loaded, record);
    }
    if (record.status === "candidate-ready" || record.status === "promoted") {
      const candidate = await this.#readCandidateForLoaded(loaded, record.candidateId);
      return {
        status: record.status === "promoted" ? "promoted" : "candidate-ready",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
        candidate: structuredClone(candidate.candidate),
      };
    }
    if (["no-change", "rejected", "cancelled", "error"].includes(record.status)) {
      return {
        status: record.status,
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    if (record.status !== "processing") {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_STATUS",
        "The Request has an unsupported lifecycle state.",
      );
    }
    const completionPath = path.join(requestRoot, "attempts", attemptId, "completion.json");
    const completion = await readJsonFile(completionPath, "completion.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!completion) {
      return {
        status: "processing",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    this.#assertCompletionRecord(completion, record);
    const outputPath = resolveRelative(
      loaded.paths.controlRoot,
      completion.outputRelativePath,
      "completion output path",
    );
    const output = await readHtmlFile(outputPath, "finalized Candidate output", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (output.sha256 !== completion.outputSha256) {
      throw new ProjectFileRepositoryError(
        "REQUEST_OUTPUT_CHANGED",
        "The finalized Candidate output changed after finalization.",
      );
    }
    return this.#completeRequest({
      target,
      requestId,
      attemptId,
      html: output.html,
    });
  }

  async #cancelRequest({ target, requestId, attemptId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const requestPath = path.join(requestRoot, "request.json");
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
    if (["processing", "candidate-ready"].includes(record.status)) {
      await this.#assertSealedRequestIdentity(loaded, record);
    }
    if (record.status === "candidate-ready") {
      const rejected = await this.#rejectCandidate({ target, candidateId: record.candidateId });
      return {
        ...rejected,
        requestId,
        attemptId,
        status: "cancelled",
      };
    }
    if (["cancelled", "rejected", "no-change", "promoted", "error"].includes(record.status)) {
      return {
        requestId,
        attemptId,
        status: "already-inactive",
        terminalStatus: record.status,
      };
    }
    if (record.status !== "processing") {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_STATUS",
        "The Request has an unsupported lifecycle state.",
      );
    }
    record.status = "cancelled";
    record.cancelledAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      requestPath,
      record,
      "request.json",
    );
    if (loaded.runtime.activeRequest?.requestId === requestId) {
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.runtimePath,
        loaded.runtime,
        "runtime-state.json",
      );
    }
    return { requestId, attemptId, status: "cancelled" };
  }

  async #saveDraft({
    target,
    operationId,
    expectedDraftRevision,
    basedOnVersionId,
    comments,
    changeEvents,
    deletedCommentIds,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    if (
      basedOnVersionId
      && String(basedOnVersionId) !== loaded.workingCopy.basedOnVersionId
    ) {
      throw new ProjectFileRepositoryError(
        "DRAFT_BASE_VERSION_MISMATCH",
        "The draft does not belong to the active Working Copy base Version.",
      );
    }
    const statePath = workingCopyStatePath(loaded.paths, loaded.workingCopy);
    const state = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!state) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The active Working Copy has no v4 state record.",
      );
    }
    assertWorkingCopyState(state, loaded.project, loaded.workingCopy);
    const draftPath = draftPathForState(loaded.paths, loaded.workingCopy, state);
    const persisted = await this.#readTrackedDraft({
      ...loaded,
      workingCopy: loaded.workingCopy,
      state,
    });
    let command;
    try {
      command = applyDraftCommand(
        persisted || {
          draftRevision: Number(state.draftRevision || 0),
          comments: [],
          changeEvents: [],
          deletedCommentIds: [],
          appliedOperationIds: [],
        },
        {
          operationId,
          expectedDraftRevision,
          comments,
          changeEvents,
          deletedCommentIds,
        },
        { randomUUID, now: () => nowIso(this.#clock) },
      );
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        String(cause?.code || "INVALID_DRAFT"),
        cause instanceof Error ? cause.message : "The draft could not be saved.",
        cause?.details || {},
      );
    }
    const activeDraft = activeDraftSnapshot(command.next, () => nowIso(this.#clock));
    if (!command.replayed) {
      const stored = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        workingCopyId: loaded.workingCopy.workingCopyId,
        basedOnVersionId: loaded.workingCopy.basedOnVersionId,
        ...activeDraft,
      };
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        draftPath,
        stored,
        "Working Copy draft",
      );
      await this.#hit("draft-record-written", {
        workingCopyId: loaded.workingCopy.workingCopyId,
        operationId: command.operationId,
      });
      const draftText = jsonText(stored);
      await atomicWriteProjectJson(loaded.paths.projectRootPath, statePath, {
        ...state,
        draftRelativePath: draftRelativePathFor(loaded.workingCopy),
        draftSha256: sha256(Buffer.from(draftText, "utf8")),
        draftRevision: activeDraft.draftRevision,
      }, "Working Copy state");
      await this.#hit("draft-saved", {
        workingCopyId: loaded.workingCopy.workingCopyId,
        operationId: command.operationId,
      });
    }
    return {
      replayed: command.replayed,
      operationId: command.operationId,
      activeDraft,
    };
  }

  async #readVersionFile({ target, requestedVersionId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const id = assertId(requestedVersionId, VERSION_ID, "versionId");
    const version = loaded.manifest.versions.find((entry) => entry.versionId === id);
    if (version) {
      const snapshotPath = versionSnapshotPath(loaded.paths, version);
      const snapshot = await readHtmlFile(snapshotPath, "Version snapshot", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (snapshot.sha256 !== version.contentSha256) {
        throw new ProjectFileRepositoryError(
          "VERSION_HASH_MISMATCH",
          "The immutable Version snapshot does not match manifest.json.",
        );
      }
      return {
        kind: "version",
        version: structuredClone(version),
        content: snapshot.html,
        sha256: snapshot.sha256,
        path: snapshotPath,
      };
    }
    const candidate = await this.#readCandidateForLoaded(loaded, loaded.runtime.activeCandidateId);
    if (
      candidate.candidate.proposedVersionId !== id
      || candidate.candidate.status !== "pending-review"
    ) {
      throw new ProjectFileRepositoryError(
        "VERSION_NOT_FOUND",
        "The requested Version does not belong to this project.",
      );
    }
    return {
      kind: "candidate",
      version: {
        versionId: candidate.candidate.proposedVersionId,
        ordinal: candidate.candidate.proposedVersionOrdinal,
        basedOnVersionId: candidate.candidate.basedOnVersionId,
        previousVersionId: candidate.candidate.previousVersionId,
        contentSha256: candidate.candidate.outputSha256,
        sourceRequestId: candidate.candidate.requestId,
        sourceCandidateId: candidate.candidate.candidateId,
        createdAt: candidate.candidate.createdAt,
      },
      candidate: structuredClone(candidate.candidate),
      content: candidate.output.html,
      sha256: candidate.output.sha256,
      path: candidate.outputPath,
    };
  }

  async #completeRequest({ target, requestId, attemptId, html }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const requestPath = path.join(requestRoot, "request.json");
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
    await this.#assertSealedRequestIdentity(loaded, record);
    if (record.status === "processing") {
      const active = loaded.runtime.activeRequest;
      if (
        active?.requestId !== record.requestId
        || active?.attemptId !== record.attemptId
        || active.status !== "processing"
        || active.candidateId !== null
        || active.inputManifestSha256 !== record.inputManifestSha256
        || active.candidateOutputSha256 !== null
        || active.candidateRecordSha256 !== null
        || loaded.runtime.activeCandidateId !== null
      ) {
        throw new ProjectFileRepositoryError(
          "FROZEN_REQUEST_BUNDLE_MISMATCH",
          "The processing Request no longer matches its runtime manifest anchor.",
        );
      }
      if (!record.inputManifestRelativePath) {
        throw new ProjectFileRepositoryError(
          "FROZEN_REQUEST_BUNDLE_MISMATCH",
          "The processing Request has no frozen input manifest path.",
        );
      }
      const inputManifest = await readJsonFileWithSha256(
        resolveRelative(
          loaded.paths.controlRoot,
          record.inputManifestRelativePath,
          "request input manifest path",
        ),
        "request input manifest",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (!inputManifest || inputManifest.sha256 !== record.inputManifestSha256) {
        throw new ProjectFileRepositoryError(
          "FROZEN_REQUEST_BUNDLE_MISMATCH",
          "The frozen Request input manifest changed after submission.",
        );
      }
    }
    const outputHtml = String(html || "");
    requireCompleteHtml(outputHtml, "Candidate HTML");
    const outputSha256 = sha256(Buffer.from(outputHtml, "utf8"));
    if (record.status === "candidate-ready" || record.status === "promoted") {
      const candidate = await this.#readCandidateForLoaded(loaded, record.candidateId);
      if (candidate.output.sha256 !== outputSha256) {
        throw new ProjectFileRepositoryError(
          "REQUEST_OUTPUT_CHANGED",
          "The finalized Candidate output changed after review began.",
        );
      }
      return {
        status: record.status === "promoted" ? "promoted" : "candidate-ready",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
        candidate: structuredClone(candidate.candidate),
      };
    }
    if (record.status === "no-change") {
      return {
        status: "no-change",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    if (outputSha256 === record.expectedSourceSha256) {
      record.status = "no-change";
      record.completedAt = nowIso(this.#clock);
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        requestPath,
        record,
        "request.json",
      );
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.runtimePath,
        loaded.runtime,
        "runtime-state.json",
      );
      return {
        status: "no-change",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    const frozenInput = await readHtmlFile(
      resolveRelative(
        loaded.paths.controlRoot,
        record.inputRelativePath,
        "frozen Request input path",
      ),
      "frozen Request input",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (frozenInput.sha256 !== record.expectedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "FROZEN_INPUT_HASH_MISMATCH",
        "The frozen Request input changed after submission.",
      );
    }
    let prepared;
    try {
      prepared = await this.#createCandidate({
        target,
        requestId: record.requestId,
        attemptId: record.attemptId,
        candidateId: record.candidateId,
        html: outputHtml,
        expectedSourceSha256: record.expectedSourceSha256,
        candidateIdentity: {
          proposedVersionId: record.proposedVersionId,
          proposedVersionOrdinal: record.proposedVersionOrdinal,
          basedOnVersionId: record.basedOnVersionId,
          previousVersionId: record.previousVersionId,
        },
        assessmentBaseHtml: frozenInput.html,
        allowSourceDivergence: true,
        inputManifestSha256: record.inputManifestSha256,
      });
    } catch (cause) {
      if (cause?.code !== "CANDIDATE_UNUSABLE") throw cause;
      record.status = "error";
      record.completedAt = nowIso(this.#clock);
      record.error = {
        code: cause.code,
        message: cause.message,
        issueCodes: Array.isArray(cause.details?.issueCodes)
          ? cause.details.issueCodes
          : [],
      };
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        requestPath,
        record,
        "request.json",
      );
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.runtimePath,
        loaded.runtime,
        "runtime-state.json",
      );
      return {
        status: "error",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    record.status = "candidate-ready";
    record.completedAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      requestPath,
      record,
      "request.json",
    );
    return {
      status: "candidate-ready",
      request: this.#publicRequest(record, loaded.paths.projectRootPath),
      candidate: structuredClone(prepared.candidate),
    };
  }

  async #assertProjectsRoot() {
    const information = await directoryInformation(
      this.#projectsRoot,
      "configured project directory",
    );
    if (!information) {
      throw new ProjectFileRepositoryError(
        "PROJECTS_ROOT_NOT_FOUND",
        "The configured PageRoot project directory is unavailable.",
      );
    }
    return information;
  }

  async #assertRegisteredProjectRootPath(projectRootPath, { allowMissing = false } = {}) {
    await this.#assertProjectsRoot();
    const root = normalizedPath(projectRootPath);
    if (!samePath(path.dirname(root), this.#projectsRoot) || path.basename(root).startsWith(".")) {
      throw new ProjectFileRepositoryError(
        "UNREGISTERED_PROJECT_ROOT",
        "A managed project root must be a direct child of the configured project directory.",
        { projectRootPath: root },
      );
    }
    const information = await directoryInformation(root, "registered project root", {
      projectRootPath: this.#projectsRoot,
    });
    if (!information && !allowMissing) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "The registered project root is unavailable.",
        { projectRootPath: root },
      );
    }
    return { projectRootPath: root, information };
  }

  async #writeRegistry(registry) {
    await this.#assertProjectsRoot();
    assertRegistry(registry);
    registry.updatedAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      this.#projectsRoot,
      this.#registryPath,
      registry,
      "project registry",
    );
  }

  async #preparePendingImport({ projectId, documentId, projectRootPath, createdAt }) {
    const target = await this.#assertRegisteredProjectRootPath(projectRootPath, {
      allowMissing: true,
    });
    if (target.information) {
      throw new ProjectFileRepositoryError(
        "PROJECT_DIRECTORY_COLLISION",
        "The selected project directory is already occupied.",
      );
    }
    const registry = await this.#readRegistry();
    if (registry.projects[projectId] || registry.pendingImports[projectId]) {
      throw new ProjectFileRepositoryError(
        "PROJECT_ID_COLLISION",
        "The new project identity is already registered.",
      );
    }
    registry.pendingImports[projectId] = {
      projectId,
      documentId,
      registeredProjectRootPath: target.projectRootPath,
      createdAt,
    };
    await this.#writeRegistry(registry);
  }

  async #clearPendingImportIfMatches(projectId, projectRootPath) {
    const registry = await this.#readRegistry();
    const pending = registry.pendingImports[projectId];
    if (
      !pending
      || !samePath(pending.registeredProjectRootPath, projectRootPath)
    ) return false;
    delete registry.pendingImports[projectId];
    await this.#writeRegistry(registry);
    return true;
  }

  async #publishPendingImport(projectId) {
    const registry = await this.#readRegistry();
    const pending = registry.pendingImports[projectId];
    if (!pending) {
      const existing = registry.projects[projectId];
      if (!existing) {
        throw new ProjectFileRepositoryError(
          "IMPORT_INTENT_NOT_FOUND",
          "The import has no registered publication intent.",
          { projectId },
        );
      }
      return existing;
    }
    const target = await this.#assertRegisteredProjectRootPath(
      pending.registeredProjectRootPath,
    );
    const loaded = await this.#loadProject(target.projectRootPath);
    if (
      loaded.project.projectId !== pending.projectId
      || loaded.project.documentId !== pending.documentId
    ) {
      throw new ProjectFileRepositoryError(
        "IMPORT_IDENTITY_MISMATCH",
        "The published import does not match its Registry intent.",
        { projectId },
      );
    }
    const rootFileIdentity = copyFileIdentity(target.information);
    const existing = registry.projects[projectId];
    if (existing) {
      if (
        !samePath(existing.registeredProjectRootPath, target.projectRootPath)
        || !sameFileIdentity(existing.rootFileIdentity, rootFileIdentity)
      ) {
        throw new ProjectFileRepositoryError(
          "IMPORT_REGISTRY_CONFLICT",
          "The import intent conflicts with an existing registered project.",
          { projectId },
        );
      }
    } else {
      registry.projects[projectId] = {
        registeredProjectRootPath: target.projectRootPath,
        rootFileIdentity,
        updatedAt: nowIso(this.#clock),
      };
      await this.#writeRegistry(registry);
    }

    const importPath = path.join(loaded.paths.recoveryRoot, "import.json");
    const importRecord = await readJsonFile(importPath, "import recovery record", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (
      !importRecord
      || importRecord.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || importRecord.kind !== "import"
      || importRecord.projectId !== pending.projectId
      || importRecord.documentId !== pending.documentId
    ) {
      throw new ProjectFileRepositoryError(
        "IMPORT_RECOVERY_INVALID",
        "The published import recovery record is invalid.",
        { projectId },
      );
    }
    if (importRecord.state !== "committed") {
      await atomicWriteProjectJson(loaded.paths.projectRootPath, importPath, {
        ...importRecord,
        state: "committed",
        committedAt: nowIso(this.#clock),
      }, "import recovery record");
    }

    const latest = await this.#readRegistry();
    const latestPending = latest.pendingImports[projectId];
    const latestProject = latest.projects[projectId];
    if (
      latestPending
      && latestProject
      && samePath(
        latestPending.registeredProjectRootPath,
        latestProject.registeredProjectRootPath,
      )
    ) {
      delete latest.pendingImports[projectId];
      await this.#writeRegistry(latest);
    }
    return (await this.#readRegistry()).projects[projectId];
  }

  // Recovery has one authority: a Registry pending-import record. A copied
  // half-finished directory cannot gain management merely because it contains
  // a plausible .pageroot/recovery/import.json.
  async #recoverPublishedImports() {
    const registry = await this.#readRegistry();
    const recovered = [];
    for (const projectId of Object.keys(registry.pendingImports)) {
      try {
        await this.#publishPendingImport(projectId);
        recovered.push(projectId);
      } catch {
        // Invalid or user-altered directories remain unmanaged. The Registry
        // intent is retained for an explicit, auditable recovery path.
      }
    }
    return recovered;
  }

  async #importExternal({
    sourcePath,
    expectedSourceSha256,
  }) {
    await ensureDirectory(this.#projectsRoot);
    await this.#assertProjectsRoot();
    await this.#recoverPublishedImports();
    const requestedPath = normalizedPath(sourcePath);
    htmlExtension(requestedPath);
    const existingTarget = await this.#resolveOpenTarget({ sourcePath: requestedPath });
    if (existingTarget) return { imported: false, target: existingTarget };
    const source = await readHtmlFile(requestedPath, "external HTML");
    if (expectedSourceSha256 && source.sha256 !== assertSha256(expectedSourceSha256, "expectedSourceSha256")) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The external HTML changed before import.",
        { expectedSourceSha256, actualSourceSha256: source.sha256 },
      );
    }
    const stem = safeProjectName(requestedPath);
    const extension = htmlExtension(requestedPath);
    const projectId = randomId("project");
    const documentId = randomId("doc");
    const createdAt = nowIso(this.#clock);
    const allocated = await this.#allocateProjectRoot(stem);
    const stagingRoot = path.join(
      this.#projectsRoot,
      `.${allocated.directoryName}.pageroot-import-${randomUUID()}`,
    );
    const paths = projectPaths(stagingRoot);
    let published = false;
    let pendingPrepared = false;
    try {
      await this.#preparePendingImport({
        projectId,
        documentId,
        projectRootPath: allocated.projectRootPath,
        createdAt,
      });
      pendingPrepared = true;
      await this.#hit("import-intent-recorded", {
        projectRootPath: allocated.projectRootPath,
        projectId,
      });
      await ensureDirectory(stagingRoot);
      for (const directory of [
        paths.controlRoot,
        paths.versionsRoot,
        paths.workingCopiesRoot,
        paths.draftsRoot,
        paths.requestsRoot,
        paths.transactionsRoot,
        paths.recoveryRoot,
      ]) await ensureDirectory(directory);
      await this.#hit("import-directories-created", { stagingRoot });

      const firstVersionId = versionId(1);
      const firstWorkingCopyId = workingCopyId(1);
      const visibleName = visibleFileName(stem, 1, extension);
      const visiblePath = path.join(stagingRoot, visibleName);
      const snapshotRelativePath = `versions/${firstVersionId}/index.html`;
      const snapshotPath = resolveRelative(
        paths.controlRoot,
        snapshotRelativePath,
        "snapshotRelativePath",
      );
      await ensureProjectDirectory(
        stagingRoot,
        path.dirname(snapshotPath),
        "initial Version directory",
      );
      await atomicWriteProjectFile(stagingRoot, snapshotPath, source.buffer, "initial Version snapshot");
      await this.#hit("import-snapshot-written", { stagingRoot });
      await atomicWriteProjectFile(stagingRoot, visiblePath, source.buffer, "initial Working Copy");
      const visibleInformation = await regularInformation(visiblePath, "initial Working Copy", {
        projectRootPath: stagingRoot,
      });
      await this.#hit("import-working-copy-written", { stagingRoot });

      const project = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        createdAt,
      };
      const firstVersion = {
        versionId: firstVersionId,
        ordinal: 1,
        basedOnVersionId: null,
        previousVersionId: null,
        contentSha256: source.sha256,
        snapshotRelativePath,
        sourceRequestId: null,
        sourceCandidateId: null,
        createdAt,
      };
      const firstWorkingCopy = {
        workingCopyId: firstWorkingCopyId,
        versionId: firstVersionId,
        basedOnVersionId: firstVersionId,
        sourceRelativePath: visibleName,
        preferredFileStem: stem,
        preferredExtension: extension,
        stateRelativePath: `working-copies/${firstWorkingCopyId}.json`,
        fileIdentity: copyFileIdentity(visibleInformation),
      };
      const manifest = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        latestOfficialVersionId: firstVersionId,
        versions: [firstVersion],
        workingCopies: [firstWorkingCopy],
      };
      const workingState = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        workingCopyId: firstWorkingCopyId,
        basedOnVersionId: firstVersionId,
        baseSha256: source.sha256,
        currentSha256: source.sha256,
        differsFromBase: false,
        draftId: `draft_${firstWorkingCopyId}`,
        draftRelativePath: draftRelativePathFor(firstWorkingCopy),
        draftSha256: null,
        draftRevision: 0,
        saveState: "saved",
        lastPersistedRevision: 0,
        lastSavedAt: createdAt,
        lastOpenedAt: createdAt,
      };
      const runtime = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        activeWorkingCopyId: firstWorkingCopyId,
        activeRequest: null,
        activeCandidateId: null,
      };
      await atomicWriteProjectJson(stagingRoot, paths.projectPath, project, "project.json");
      await atomicWriteProjectJson(stagingRoot, paths.manifestPath, manifest, "manifest.json");
      await atomicWriteProjectJson(
        stagingRoot,
        workingCopyStatePath(paths, firstWorkingCopy),
        workingState,
        "initial Working Copy state",
      );
      await atomicWriteProjectJson(stagingRoot, paths.runtimePath, runtime, "runtime-state.json");
      await atomicWriteProjectJson(stagingRoot, path.join(paths.recoveryRoot, "import.json"), {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        kind: "import",
        state: "prepared",
        projectId,
        documentId,
        externalSourceSha256: source.sha256,
        createdAt,
      }, "import recovery record");
      await atomicWriteProjectFile(
        stagingRoot,
        path.join(stagingRoot, "PROJECT.md"),
        Buffer.from(`# ${stem}\n\n`, "utf8"),
        "PROJECT.md",
      );
      await this.#hit("import-metadata-written", { stagingRoot });

      const sourceBeforePublish = await readHtmlFile(requestedPath, "external HTML");
      if (sourceBeforePublish.sha256 !== source.sha256) {
        throw new ProjectFileRepositoryError(
          "SOURCE_HASH_CONFLICT",
          "The external HTML changed during import.",
          { expectedSourceSha256: source.sha256, actualSourceSha256: sourceBeforePublish.sha256 },
        );
      }
      await rename(stagingRoot, allocated.projectRootPath);
      await syncDirectory(this.#projectsRoot);
      published = true;
      await this.#hit("import-project-published", {
        projectRootPath: allocated.projectRootPath,
        projectId,
      });
      await this.#publishPendingImport(projectId);
      await this.#hit("import-registry-written", {
        projectRootPath: allocated.projectRootPath,
        projectId,
      });
      return {
        imported: true,
        target: publicOpenTarget({
          project,
          projectRootPath: allocated.projectRootPath,
          targetKind: "working-copy",
          workingCopy: firstWorkingCopy,
          version: firstVersion,
          exactSourcePath: path.join(allocated.projectRootPath, visibleName),
          sourceSha256: source.sha256,
        }),
      };
    } catch (cause) {
      if (!published) {
        await rm(stagingRoot, { recursive: true, force: true });
        if (pendingPrepared) {
          await this.#clearPendingImportIfMatches(
            projectId,
            allocated.projectRootPath,
          ).catch(() => {});
        }
      }
      throw cause;
    }
  }

  async #allocateProjectRoot(stem) {
    for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
      const directoryName = ordinal === 1 ? stem : `${stem} (${ordinal})`;
      const candidate = path.join(this.#projectsRoot, directoryName);
      if (!(await directoryInformation(candidate, "project directory"))) {
        return { directoryName, projectRootPath: candidate };
      }
    }
    throw new ProjectFileRepositoryError(
      "PROJECT_DIRECTORY_COLLISION",
      "A unique project folder could not be allocated.",
    );
  }

  async #loadProject(projectRootPath) {
    const root = normalizedPath(projectRootPath);
    const paths = projectPaths(root);
    if (!(await directoryInformation(root, "project root"))) {
      throw new ProjectFileRepositoryError(
        "PROJECT_ROOT_NOT_FOUND",
        "The project folder is no longer available.",
        { projectRootPath: root },
      );
    }
    if (!(await directoryInformation(paths.controlRoot, ".pageroot", {
      projectRootPath: root,
    }))) {
      throw new ProjectFileRepositoryError(
        "PROJECT_CONTROL_NOT_FOUND",
        "The project folder no longer contains its PageRoot identity.",
        { projectRootPath: root },
      );
    }
    for (const [directoryPath, label] of [
      [paths.versionsRoot, "versions"],
      [paths.workingCopiesRoot, "working-copies"],
      [paths.draftsRoot, "drafts"],
      [paths.requestsRoot, "requests"],
      [paths.transactionsRoot, "transactions"],
      [paths.recoveryRoot, "recovery"],
    ]) {
      if (!(await directoryInformation(directoryPath, label, {
        projectRootPath: root,
      }))) {
        throw new ProjectFileRepositoryError(
          "PROJECT_CONTROL_NOT_FOUND",
          `The project folder has no ${label} directory.`,
          { projectRootPath: root },
        );
      }
    }
    const project = assertProjectIdentity(await readJsonFile(paths.projectPath, "project.json", {
      projectRootPath: root,
    }));
    const manifest = assertManifest(
      await readJsonFile(paths.manifestPath, "manifest.json", {
        projectRootPath: root,
      }),
      project,
    );
    const runtime = assertRuntime(
      await readJsonFile(paths.runtimePath, "runtime-state.json", {
        projectRootPath: root,
      }),
      project,
      manifest,
    );
    return { paths, project, manifest, runtime };
  }

  async #recoverRegisteredRootRename(projectId, record, { documentId = null } = {}) {
    const registeredRootPath = normalizedPath(record.registeredProjectRootPath);
    const known = await this.#assertRegisteredProjectRootPath(registeredRootPath, {
      allowMissing: true,
    });
    if (known.information) {
      const observedIdentity = copyFileIdentity(known.information);
      if (!sameFileIdentity(record.rootFileIdentity, observedIdentity)) {
        let loaded;
        try {
          loaded = await this.#loadProject(registeredRootPath);
        } catch (cause) {
          throw new ProjectFileRepositoryError(
            "REGISTERED_PROJECT_IDENTITY_CHANGED",
            "The project returned at its registered path but its identity cannot be verified.",
            { projectId, registeredProjectRootPath: registeredRootPath, cause: cause?.code || null },
          );
        }
        if (
          loaded.project.projectId !== projectId
          || (documentId && loaded.project.documentId !== documentId)
        ) {
          throw new ProjectFileRepositoryError(
            "REGISTERED_PROJECT_IDENTITY_CHANGED",
            "The project returned at its registered path with a different identity.",
            { projectId, registeredProjectRootPath: registeredRootPath },
          );
        }
        // Root filesystem identity is only a same-parent rename clue. A
        // cross-volume move that returns to the exact registered path is
        // allowed only after the stable IDs and manifest have been verified.
        const latest = await this.#readRegistry();
        const latestRecord = latest.projects[projectId];
        if (
          !latestRecord
          || !samePath(latestRecord.registeredProjectRootPath, registeredRootPath)
          || !sameFileIdentity(latestRecord.rootFileIdentity, record.rootFileIdentity)
        ) {
          throw new ProjectFileRepositoryError(
            "REGISTERED_PROJECT_RACE",
            "The registered project root changed while its return was being verified.",
            { projectId },
          );
        }
        latestRecord.rootFileIdentity = observedIdentity;
        latestRecord.updatedAt = nowIso(this.#clock);
        await this.#writeRegistry(latest);
      }
      return registeredRootPath;
    }

    let entries;
    try {
      entries = await readdir(this.#projectsRoot, { withFileTypes: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const candidatePath = path.join(this.#projectsRoot, entry.name);
      const candidate = await this.#assertRegisteredProjectRootPath(candidatePath, {
        allowMissing: true,
      });
      if (
        !candidate.information
        || !sameFileIdentity(record.rootFileIdentity, copyFileIdentity(candidate.information))
      ) continue;
      try {
        const loaded = await this.#loadProject(candidatePath);
        if (
          loaded.project.projectId === projectId
          && (!documentId || loaded.project.documentId === documentId)
        ) candidates.push({ candidatePath, information: candidate.information });
      } catch {
        // The directory has the same device/inode clue but no valid project
        // contract. It cannot become the registered root.
      }
    }
    if (candidates.length !== 1) return null;

    const chosen = candidates[0];
    const latest = await this.#readRegistry();
    const latestRecord = latest.projects[projectId];
    if (
      !latestRecord
      || !samePath(latestRecord.registeredProjectRootPath, registeredRootPath)
      || !sameFileIdentity(latestRecord.rootFileIdentity, record.rootFileIdentity)
    ) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_RACE",
        "The registered project root changed while its rename was being recovered.",
        { projectId },
      );
    }
    latestRecord.registeredProjectRootPath = chosen.candidatePath;
    latestRecord.rootFileIdentity = copyFileIdentity(chosen.information);
    latestRecord.updatedAt = nowIso(this.#clock);
    await this.#writeRegistry(latest);
    return chosen.candidatePath;
  }

  async #loadRegisteredProject({
    projectId,
    documentId = null,
    declaredProjectRootPath = null,
  }) {
    const id = assertId(projectId, PROJECT_ID, "projectId");
    const expectedDocumentId = documentId
      ? assertId(documentId, DOCUMENT_ID, "documentId")
      : null;
    const registry = await this.#readRegistry();
    const record = registry.projects[id];
    if (!record) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "This project is no longer registered for PageRoot writes.",
        { projectId: id },
      );
    }
    if (
      declaredProjectRootPath
      && !samePath(declaredProjectRootPath, record.registeredProjectRootPath)
    ) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_PATH_MISMATCH",
        "The supplied project path is not the registered PageRoot project root.",
        {
          projectId: id,
          registeredProjectRootPath: record.registeredProjectRootPath,
        },
      );
    }
    const projectRootPath = await this.#recoverRegisteredRootRename(id, record, {
      documentId: expectedDocumentId,
    });
    if (!projectRootPath) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "The registered project is temporarily unavailable; its in-memory changes remain retained.",
        {
          projectId: id,
          registeredProjectRootPath: record.registeredProjectRootPath,
        },
      );
    }
    const loaded = await this.#loadProject(projectRootPath);
    if (
      loaded.project.projectId !== id
      || (expectedDocumentId && loaded.project.documentId !== expectedDocumentId)
    ) {
      throw new ProjectFileRepositoryError(
        "PROJECT_IDENTITY_CHANGED",
        "The registered project root no longer matches the active document identity.",
        { projectId: id, projectRootPath },
      );
    }
    return loaded;
  }

  async #registeredProjectForSource(sourcePath) {
    const exactSourcePath = normalizedPath(sourcePath);
    const registry = await this.#readRegistry();
    const candidates = [];
    for (const [projectId, record] of Object.entries(registry.projects)) {
      let resolvedRoot;
      try {
        resolvedRoot = await this.#recoverRegisteredRootRename(projectId, record);
      } catch (cause) {
        // A v4 project only owns an HTML after its root, stable identity and
        // on-disk contract all validate. A damaged record is therefore not an
        // opening target, even for a file beneath its former root: callers
        // can import that HTML as a fresh V1 instead of migrating or repairing
        // pre-v4 state.
        if (invalidRegisteredProjectError(cause)) continue;
        throw cause;
      }
      if (resolvedRoot && pathInside(resolvedRoot, exactSourcePath)) {
        candidates.push({ projectId, projectRootPath: resolvedRoot });
      }
    }
    if (candidates.length > 1) {
      throw new ProjectFileRepositoryError(
        "MANAGED_PATH_AMBIGUOUS",
        "More than one registered project claims this HTML path.",
        { sourcePath: exactSourcePath, projectIds: candidates.map((item) => item.projectId) },
      );
    }
    if (candidates.length === 0) return null;
    try {
      return await this.#loadRegisteredProject({
        projectId: candidates[0].projectId,
        declaredProjectRootPath: candidates[0].projectRootPath,
      });
    } catch (cause) {
      if (invalidRegisteredProjectError(cause)) return null;
      throw cause;
    }
  }

  async #resolveOpenTarget({ sourcePath }) {
    const exactSourcePath = normalizedPath(sourcePath);
    htmlExtension(exactSourcePath);
    const loaded = await this.#registeredProjectForSource(exactSourcePath);
    if (!loaded) return null;
    const source = await readHtmlFile(exactSourcePath, "HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const target = await this.#targetForExactPath(loaded, exactSourcePath, source);
    // An unlisted user HTML inside a project root is still an external file:
    // PageRoot must never infer a Working Copy merely from its location.
    return target;
  }

  async #rebindWorkingCopyPath(loaded, workingCopy, exactSourcePath, information) {
    const relative = path.relative(loaded.paths.projectRootPath, exactSourcePath)
      .split(path.sep)
      .join("/");
    const sourceRelativePath = topLevelHtmlRelativePath(relative, "sourceRelativePath");
    const naming = preferredNamingForWorkingCopyPath(
      sourceRelativePath,
      workingCopy.workingCopyId,
    );
    const changed = (
      workingCopy.sourceRelativePath !== sourceRelativePath
      || workingCopy.preferredFileStem !== naming.preferredFileStem
      || workingCopy.preferredExtension !== naming.preferredExtension
      || !sameFileIdentity(workingCopy.fileIdentity, copyFileIdentity(information))
    );
    if (!changed) return false;
    workingCopy.sourceRelativePath = sourceRelativePath;
    workingCopy.preferredFileStem = naming.preferredFileStem;
    workingCopy.preferredExtension = naming.preferredExtension;
    workingCopy.fileIdentity = copyFileIdentity(information);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.manifestPath,
      loaded.manifest,
      "manifest.json",
    );
    return true;
  }

  async #findMissingWorkingCopyByHash(loaded, source) {
    const candidates = [];
    for (const workingCopy of loaded.manifest.workingCopies) {
      const mappedPath = workingCopySourcePath(loaded.paths, workingCopy);
      const mappedInformation = await regularInformation(mappedPath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (mappedInformation) continue;
      const state = await readJsonFile(
        workingCopyStatePath(loaded.paths, workingCopy),
        "Working Copy state",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (!state) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_STATE_NOT_FOUND",
          "A managed Working Copy has no v4 state record.",
        );
      }
      assertWorkingCopyState(state, loaded.project, workingCopy);
      if (state.currentSha256 === source.sha256) candidates.push(workingCopy);
    }
    if (candidates.length > 1) {
      throw new ProjectFileRepositoryError(
        "MANAGED_PATH_AMBIGUOUS",
        "More than one missing Working Copy matches this HTML content.",
        {
          projectId: loaded.project.projectId,
          workingCopyIds: candidates.map((entry) => entry.workingCopyId),
        },
      );
    }
    return candidates[0] || null;
  }

  async #targetForExactPath(loaded, exactSourcePath, source) {
    const { paths, project, manifest } = loaded;
    for (const version of manifest.versions) {
      const snapshotPath = versionSnapshotPath(paths, version);
      if (samePath(snapshotPath, exactSourcePath)) {
        if (source.sha256 !== version.contentSha256) {
          throw new ProjectFileRepositoryError(
            "VERSION_SNAPSHOT_HASH_MISMATCH",
            "The immutable Version snapshot changed and cannot be opened.",
          );
        }
        return publicOpenTarget({
          project,
          projectRootPath: paths.projectRootPath,
          targetKind: "version",
          version,
          exactSourcePath,
          sourceSha256: source.sha256,
        });
      }
    }
    const direct = manifest.workingCopies.find((workingCopy) => (
      samePath(workingCopySourcePath(paths, workingCopy), exactSourcePath)
    ));
    if (direct) {
      // Returning a Working Copy to its registered relative path restores the
      // mapping even after a copy-and-delete changed its inode.
      await this.#rebindWorkingCopyPath(loaded, direct, exactSourcePath, source.information);
      return publicOpenTarget({
        project,
        projectRootPath: paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: direct,
        version: manifest.versions.find((version) => version.versionId === direct.versionId),
        exactSourcePath,
        sourceSha256: source.sha256,
      });
    }
    const matching = manifest.workingCopies.filter((workingCopy) => (
      sameFileIdentity(workingCopy.fileIdentity, copyFileIdentity(source.information))
    ));
    if (matching.length > 1) {
      throw new ProjectFileRepositoryError(
        "MANAGED_PATH_AMBIGUOUS",
        "More than one Working Copy has the same filesystem identity.",
        {
          projectId: project.projectId,
          workingCopyIds: matching.map((entry) => entry.workingCopyId),
        },
      );
    }
    const workingCopy = matching[0]
      || await this.#findMissingWorkingCopyByHash(loaded, source);
    if (!workingCopy) return null;
    await this.#rebindWorkingCopyPath(loaded, workingCopy, exactSourcePath, source.information);
    return publicOpenTarget({
      project,
      projectRootPath: paths.projectRootPath,
      targetKind: "working-copy",
      workingCopy,
      version: manifest.versions.find((version) => version.versionId === workingCopy.versionId),
      exactSourcePath,
      sourceSha256: source.sha256,
    });
  }

  async #resolveMutationTarget(target) {
    if (!isObject(target)) {
      throw new ProjectFileRepositoryError("OPEN_TARGET_REQUIRED", "A managed OpenTarget is required.");
    }
    const projectId = assertId(target.projectId, PROJECT_ID, "projectId");
    const documentId = assertId(target.documentId, DOCUMENT_ID, "documentId");
    const workingCopyIdValue = assertId(target.workingCopyId, WORKING_COPY_ID, "workingCopyId");
    const declaredProjectRootPath = normalizedPath(target.projectRootPath);
    const loaded = await this.#loadRegisteredProject({
      projectId,
      documentId,
      declaredProjectRootPath,
    });
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === workingCopyIdValue,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError("WORKING_COPY_NOT_FOUND", "The active Working Copy no longer exists.");
    }
    let exactSourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    let sourceInformation = await regularInformation(exactSourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!sourceInformation) {
      const recoveredPath = await this.#findWorkingCopyByFileIdentity(
        loaded.paths.projectRootPath,
        workingCopy.fileIdentity,
      );
      if (!recoveredPath) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_UNAVAILABLE",
          "The active HTML is temporarily unavailable; PageRoot did not write outside its registered path.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
      exactSourcePath = recoveredPath;
      sourceInformation = await regularInformation(exactSourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      await this.#rebindWorkingCopyPath(
        loaded,
        workingCopy,
        exactSourcePath,
        sourceInformation,
      );
    } else {
      await this.#rebindWorkingCopyPath(
        loaded,
        workingCopy,
        exactSourcePath,
        sourceInformation,
      );
    }
    const source = await readHtmlFile(exactSourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    return { ...loaded, workingCopy, exactSourcePath, source };
  }

  async #findWorkingCopyByFileIdentity(projectRootPath, identity) {
    let entries;
    try {
      entries = await listProjectDirectory(
        projectRootPath,
        projectRootPath,
        "project root",
      );
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    }
    const matches = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      const candidate = path.join(projectRootPath, entry.name);
      if (!HTML_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const information = await regularInformation(candidate, "Working Copy", {
        projectRootPath,
      });
      if (information && sameFileIdentity(identity, copyFileIdentity(information))) {
        matches.push(candidate);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  async #saveWorkingCopy({ target, html, expectedSourceSha256, editRevision }) {
    const loaded = await this.#resolveMutationTarget(target);
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    if (loaded.source.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed outside PageRoot and was not overwritten.",
        { expectedSourceSha256: expected, actualSourceSha256: loaded.source.sha256 },
      );
    }
    const nextHtml = String(html || "");
    requireCompleteHtml(nextHtml, "Working Copy HTML");
    const nextBuffer = Buffer.from(nextHtml, "utf8");
    const nextSha256 = sha256(nextBuffer);
    const revision = Number.isSafeInteger(Number(editRevision)) && Number(editRevision) >= 0
      ? Number(editRevision)
      : 0;
    const transactionPath = path.join(
      loaded.paths.transactionsRoot,
      `save_${loaded.workingCopy.workingCopyId}_${revision || "current"}.json`,
    );
    let transaction = {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      kind: "save",
      state: "prepared",
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: loaded.workingCopy.workingCopyId,
      sourceRelativePath: loaded.workingCopy.sourceRelativePath,
      expectedSourceSha256: expected,
      targetSourceSha256: nextSha256,
      editRevision: revision,
      preparedAt: nowIso(this.#clock),
      sourceGuardRelativePath: `transactions/${path.basename(transactionPath, ".json")}.source-before.html`,
      sourceReplacementRelativePath: `transactions/${path.basename(transactionPath, ".json")}.replacement.html`,
    };
    const artifacts = saveTransactionArtifactPaths(loaded.paths, transactionPath, transaction);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "save transaction",
    );
    await this.#hit("save-prepared", { transactionPath });
    await writeFileNoReplace(
      artifacts.sourceReplacementPath,
      nextBuffer,
      nextSha256,
      "save source replacement",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    await this.#hit("save-replacement-written", { transactionPath });
    if (await regularInformation(artifacts.sourceGuardPath, "save source guard", {
      projectRootPath: loaded.paths.projectRootPath,
    })) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_INVALID",
        "The save source guard is unexpectedly occupied.",
      );
    }
    // Moving the source to a private guard is the compare step: it preserves
    // whichever bytes occupy the user-visible path at this exact boundary.
    // Publishing then uses link() and therefore cannot replace an external
    // writer that creates a new source path while this save is in flight.
    await rename(loaded.exactSourcePath, artifacts.sourceGuardPath);
    await assertRealPathInsideProject(
      loaded.paths.projectRootPath,
      artifacts.sourceGuardPath,
      "save source guard",
      { expectedKind: "file" },
    );
    transaction = { ...transaction, state: "source-staged" };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "save transaction",
    );
    await this.#hit("save-source-staged", { transactionPath });
    const sourceBeforeWrite = await readHtmlFile(artifacts.sourceGuardPath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (sourceBeforeWrite.sha256 !== expected) {
      try {
        await link(artifacts.sourceGuardPath, loaded.exactSourcePath);
      } catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
      }
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed before PageRoot could save it.",
        { expectedSourceSha256: expected, actualSourceSha256: sourceBeforeWrite.sha256 },
      );
    }
    try {
      await link(artifacts.sourceReplacementPath, loaded.exactSourcePath);
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed while PageRoot was saving it.",
        { expectedSourceSha256: expected },
      );
    }
    await assertRealPathInsideProject(
      loaded.paths.projectRootPath,
      loaded.exactSourcePath,
      "Working Copy",
      { expectedKind: "file" },
    );
    transaction = { ...transaction, state: "source-published" };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "save transaction",
    );
    const written = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (written.sha256 !== nextSha256) {
      throw new ProjectFileRepositoryError("SAVE_HASH_MISMATCH", "The saved Working Copy does not match its requested bytes.");
    }
    const guarded = await readHtmlFile(artifacts.sourceGuardPath, "save source guard", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (guarded.sha256 !== expected) {
      // An editor that kept the original file descriptor open writes through
      // the guard after PageRoot has created its no-replace path. Put those
      // external bytes back with the same move-then-link protocol: PageRoot
      // never overwrites a newly created visible path, and both byte streams
      // remain in the transaction if a second writer races this recovery.
      await unlinkIfPresent(artifacts.sourceReplacementPath);
      await rename(loaded.exactSourcePath, artifacts.sourceReplacementPath);
      try {
        await link(artifacts.sourceGuardPath, loaded.exactSourcePath);
      } catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
      }
      await syncDirectory(loaded.paths.transactionsRoot);
      await syncDirectory(loaded.paths.projectRootPath);
      transaction = {
        ...transaction,
        state: "committed",
        recovery: "source-guard-restored",
        committedAt: nowIso(this.#clock),
      };
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        transactionPath,
        transaction,
        "save transaction",
      );
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed through an already-open external file handle.",
        { expectedSourceSha256: expected, actualSourceSha256: guarded.sha256 },
      );
    }
    await Promise.all([
      unlinkIfPresent(artifacts.sourceGuardPath),
      unlinkIfPresent(artifacts.sourceReplacementPath),
    ]);
    await syncDirectory(loaded.paths.transactionsRoot);
    await this.#hit("save-source-written", { transactionPath });
    loaded.workingCopy.fileIdentity = copyFileIdentity(written.information);
    const statePath = workingCopyStatePath(loaded.paths, loaded.workingCopy);
    const currentState = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!currentState) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The active Working Copy has no v4 state record.",
      );
    }
    assertWorkingCopyState(currentState, loaded.project, loaded.workingCopy);
    const nextState = {
      ...currentState,
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: loaded.workingCopy.workingCopyId,
      currentSha256: nextSha256,
      differsFromBase: nextSha256 !== currentState.baseSha256,
      saveState: "saved",
      lastPersistedRevision: Math.max(
        Number(currentState.lastPersistedRevision || 0),
        revision,
      ),
      lastSavedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      statePath,
      nextState,
      "Working Copy state",
    );
    await this.#hit("save-state-written", { transactionPath });
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.manifestPath,
      loaded.manifest,
      "manifest.json",
    );
    await this.#hit("save-manifest-written", { transactionPath });
    transaction = {
      ...transaction,
      state: "committed",
      committedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "save transaction",
    );
    await this.#hit("save-committed", { transactionPath });
    return {
      target: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: loaded.workingCopy,
        version: loaded.manifest.versions.find(
          (version) => version.versionId === loaded.workingCopy.versionId,
        ),
        exactSourcePath: loaded.exactSourcePath,
        sourceSha256: nextSha256,
      }),
      lastPersistedRevision: nextState.lastPersistedRevision,
      currentSha256: nextSha256,
      versionCreated: false,
    };
  }

  async #createCandidate({
    target,
    requestId,
    attemptId,
    candidateId,
    html,
    expectedSourceSha256,
    candidateIdentity = null,
    assessmentBaseHtml = null,
    allowSourceDivergence = false,
    inputManifestSha256 = null,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const request = String(requestId || "");
    if (!SAFE_REQUEST_ID.test(request)) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
    }
    const attempt = String(attemptId || "attempt_001");
    const requestRoot = requestRootPath(loaded.paths, request);
    const requestRecord = await readJsonFile(
      path.join(requestRoot, "request.json"),
      "request.json",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (!requestRecord) {
      throw new ProjectFileRepositoryError(
        "REQUEST_REQUIRED",
        "Candidate creation requires a frozen processing Request.",
      );
    }
    this.#assertRequestRecord(requestRecord, loaded, { requestId: request, attemptId: attempt });
    await this.#assertSealedRequestIdentity(loaded, requestRecord);
    if (requestRecord.status !== "processing") {
      throw new ProjectFileRepositoryError(
        "REQUEST_NOT_PROCESSING",
        "Only a processing Request can create its Candidate.",
      );
    }
    const activeRequest = loaded.runtime.activeRequest;
    if (
      activeRequest?.requestId !== requestRecord.requestId
      || activeRequest?.attemptId !== requestRecord.attemptId
      || activeRequest.status !== "processing"
      || activeRequest.candidateId !== null
      || activeRequest.inputManifestSha256 !== requestRecord.inputManifestSha256
      || activeRequest.candidateOutputSha256 !== null
      || activeRequest.candidateRecordSha256 !== null
      || loaded.runtime.activeCandidateId !== null
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "Candidate creation requires the processing Request runtime seal.",
      );
    }
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const manifestAnchor = assertSha256(inputManifestSha256, "inputManifestSha256");
    if (
      requestRecord.expectedSourceSha256 !== expected
      || requestRecord.inputManifestSha256 !== manifestAnchor
      || requestRecord.candidateId !== candidateId
      || !isObject(candidateIdentity)
      || candidateIdentity.proposedVersionId !== requestRecord.proposedVersionId
      || Number(candidateIdentity.proposedVersionOrdinal) !== Number(requestRecord.proposedVersionOrdinal)
      || candidateIdentity.basedOnVersionId !== requestRecord.basedOnVersionId
      || candidateIdentity.previousVersionId !== requestRecord.previousVersionId
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_CANDIDATE_IDENTITY_MISMATCH",
        "Candidate creation must use the frozen Request identity and manifest seal.",
      );
    }
    if (!allowSourceDivergence && loaded.source.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed before Candidate preparation.",
      );
    }
    const candidateHtml = String(html || "");
    requireCompleteHtml(candidateHtml, "Candidate HTML");
    const outputBuffer = Buffer.from(candidateHtml, "utf8");
    const outputSha256 = sha256(outputBuffer);
    const planned = {
      proposedVersionId: assertId(
        candidateIdentity.proposedVersionId,
        VERSION_ID,
        "proposedVersionId",
      ),
      proposedVersionOrdinal: Number(candidateIdentity.proposedVersionOrdinal),
      basedOnVersionId: assertId(
        candidateIdentity.basedOnVersionId,
        VERSION_ID,
        "basedOnVersionId",
      ),
      previousVersionId: assertId(
        candidateIdentity.previousVersionId,
        VERSION_ID,
        "previousVersionId",
      ),
    };
    if (
      !Number.isSafeInteger(planned.proposedVersionOrdinal)
      || planned.proposedVersionOrdinal < 2
      || planned.proposedVersionId !== versionId(planned.proposedVersionOrdinal)
    ) {
      throw new ProjectFileRepositoryError("INVALID_CANDIDATE", "Candidate Version identity is invalid.");
    }
    const id = candidateId;
    assertCandidateId(id);
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      requestRoot,
      "Candidate request directory",
    );
    const outputPath = path.join(requestRoot, "candidate.html");
    const candidatePath = path.join(requestRoot, "candidate.json");
    const existingCandidateRecord = await readJsonFileWithSha256(candidatePath, "candidate.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const existingCandidate = existingCandidateRecord?.value || null;
    let candidateRecordSha256;
    if (existingCandidate) {
      assertCandidateRecord(existingCandidate, loaded);
      if (
        existingCandidate.candidateId !== id
        || existingCandidate.outputSha256 !== outputSha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_COLLISION",
          "This Request already owns another Candidate.",
        );
      }
      const existingOutput = await readHtmlFile(outputPath, "Candidate HTML", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const active = loaded.runtime.activeRequest;
      if (
        active?.requestId !== request
        || active?.attemptId !== attempt
        || active.status !== "pending-review"
        || active.candidateId !== id
        || active.inputManifestSha256 !== manifestAnchor
        || active.candidateOutputSha256 !== existingOutput.sha256
        || active.candidateRecordSha256 !== existingCandidateRecord.sha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "An existing Candidate is not sealed by the active runtime authority.",
        );
      }
      candidateRecordSha256 = existingCandidateRecord.sha256;
    } else {
      const assessment = assessedCandidate(
        typeof assessmentBaseHtml === "string"
          ? assessmentBaseHtml
          : loaded.source.html,
        candidateHtml,
        this.#clock,
      );
      await writeFileNoReplace(outputPath, outputBuffer, outputSha256, "Candidate HTML", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const candidateRecord = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        candidateId: id,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        requestId: request,
        attemptId: attempt,
        proposedVersionId: planned.proposedVersionId,
        proposedVersionOrdinal: planned.proposedVersionOrdinal,
        basedOnVersionId: planned.basedOnVersionId,
        previousVersionId: planned.previousVersionId,
        sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
        expectedSourceSha256: expected,
        outputRelativePath: `requests/${request}/candidate.html`,
        outputSha256,
        assessment,
        status: "pending-review",
        createdAt: nowIso(this.#clock),
      };
      assertCandidateRecord(candidateRecord, loaded);
      const candidateRecordBuffer = Buffer.from(jsonText(candidateRecord), "utf8");
      candidateRecordSha256 = sha256(candidateRecordBuffer);
      await atomicWriteProjectFile(
        loaded.paths.projectRootPath,
        candidatePath,
        candidateRecordBuffer,
        "candidate.json",
      );
    }
    loaded.runtime.activeRequest = {
      requestId: request,
      candidateId: id,
      attemptId: attempt,
      status: "pending-review",
      inputManifestSha256: manifestAnchor,
      candidateOutputSha256: outputSha256,
      candidateRecordSha256,
    };
    loaded.runtime.activeCandidateId = id;
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.runtimePath,
      loaded.runtime,
      "runtime-state.json",
    );
    await this.#hit("candidate-prepared", { requestId: request, candidateId: id });
    return await this.#readCandidateForLoaded(loaded, id);
  }

  async #readCandidateForLoaded(loaded, candidateId) {
    const requested = candidateId || loaded.runtime.activeCandidateId;
    if (!requested || !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(requested)) {
      throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "No Candidate is awaiting review.");
    }
    const activeRequest = loaded.runtime.activeRequest;
    let candidatePath = activeRequest?.requestId
      ? path.join(loaded.paths.requestsRoot, activeRequest.requestId, "candidate.json")
      : null;
    let candidateRecord = candidatePath
      ? await readJsonFileWithSha256(candidatePath, "candidate.json", {
        projectRootPath: loaded.paths.projectRootPath,
      })
      : null;
    let candidate = candidateRecord?.value || null;
    if (!candidate || candidate.candidateId !== requested) {
      if (activeRequest?.status === "pending-review" && activeRequest.candidateId === requested) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "The runtime-sealed Candidate record is no longer available.",
        );
      }
      ({ candidatePath, candidate, candidateRecord } = await this.#findCandidateById(loaded, requested));
    }
    if (
      !candidate
      || candidate.candidateId !== requested
      || candidate.projectId !== loaded.project.projectId
      || candidate.documentId !== loaded.project.documentId
    ) {
      throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "The requested Candidate was not found.");
    }
    assertCandidateRecord(candidate, loaded);
    const outputPath = resolveRelative(
      loaded.paths.controlRoot,
      candidate.outputRelativePath,
      "candidate output path",
    );
    const output = await readHtmlFile(outputPath, "Candidate HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (output.sha256 !== candidate.outputSha256) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_HASH_MISMATCH",
        "The Candidate changed after validation and must be reviewed again.",
      );
    }
    if (candidate.status === "pending-review") {
      if (
        activeRequest?.status !== "pending-review"
        || activeRequest.candidateId !== requested
        || activeRequest.candidateOutputSha256 !== output.sha256
        || activeRequest.candidateRecordSha256 !== candidateRecord?.sha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "The Candidate no longer matches the runtime authority sealed for review.",
        );
      }
    }
    return {
      candidate,
      candidatePath,
      candidateRecordSha256: candidateRecord?.sha256 || null,
      outputPath,
      output,
    };
  }

  async #findCandidateById(loaded, candidateId) {
    let entries;
    try {
      entries = await listProjectDirectory(
        loaded.paths.projectRootPath,
        loaded.paths.requestsRoot,
        "requests",
      );
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "The requested Candidate was not found.");
      }
      throw cause;
    }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_REQUEST_ID.test(entry.name)) {
        continue;
      }
      const candidatePath = path.join(loaded.paths.requestsRoot, entry.name, "candidate.json");
      const candidateRecord = await readJsonFileWithSha256(candidatePath, "candidate.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const candidate = candidateRecord?.value || null;
      if (candidate?.candidateId === candidateId) {
        matches.push({ candidatePath, candidate, candidateRecord });
      }
    }
    if (matches.length !== 1) {
      throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "The requested Candidate was not found.");
    }
    return matches[0];
  }

  async #rejectCandidate({ target, candidateId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const current = await this.#readCandidateForLoaded(loaded, candidateId);
    if (current.candidate.status === "promoted") {
      throw new ProjectFileRepositoryError("CANDIDATE_ALREADY_PROMOTED", "The Candidate is already a formal Version.");
    }
    const requestPath = path.join(
      requestRootPath(loaded.paths, current.candidate.requestId),
      "request.json",
    );
    const request = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (request?.candidateId === current.candidate.candidateId) {
      request.status = "rejected";
      request.rejectedAt = nowIso(this.#clock);
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        requestPath,
        request,
        "request.json",
      );
    }
    // Record the terminal Request decision before releasing the runtime
    // authority. A crash at either boundary then leaves a Candidate that is
    // unavailable for adoption, rather than a mutable record still claiming
    // the old sealed digest.
    loaded.runtime.activeRequest = null;
    loaded.runtime.activeCandidateId = null;
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.runtimePath,
      loaded.runtime,
      "runtime-state.json",
    );
    current.candidate.status = "rejected";
    current.candidate.rejectedAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      current.candidatePath,
      current.candidate,
      "candidate.json",
    );
    return {
      candidateId: current.candidate.candidateId,
      status: "rejected",
      latestOfficialVersionId: loaded.manifest.latestOfficialVersionId,
    };
  }

  async #allocatePromotionWorkingCopy(loaded, {
    preferredFileStem,
    preferredExtension,
    versionOrdinal,
    startAt = 0,
  }) {
    for (let allocationOrdinal = startAt; allocationOrdinal < 10_000; allocationOrdinal += 1) {
      const sourceRelativePath = visibleFileName(
        preferredFileStem,
        versionOrdinal,
        preferredExtension,
        allocationOrdinal,
      );
      const candidatePath = resolveRelative(
        loaded.paths.projectRootPath,
        sourceRelativePath,
        "Promotion Working Copy path",
      );
      const information = await lstat(candidatePath).catch((cause) => {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      });
      // lstat deliberately treats ordinary files, directories, hard links and
      // symbolic links alike as user-owned collisions.
      if (!information) return { sourceRelativePath, allocationOrdinal };
    }
    throw new ProjectFileRepositoryError(
      "PROMOTION_PATH_ALLOCATION_EXHAUSTED",
      "PageRoot could not allocate a collision-free Version Working Copy path.",
    );
  }

  #preparedPromotionWorkingCopyPath(loaded, transaction) {
    const relative = ensureRelativePath(
      transaction.preparedWorkingCopyRelativePath,
      "preparedWorkingCopyRelativePath",
    );
    const expectedPrefix = "transactions/" + transaction.transactionId + "/";
    if (
      !relative.startsWith(expectedPrefix)
      || !relative.endsWith(transaction.preferredExtension)
    ) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_TRANSACTION_INVALID",
        "The Promotion prepared Working Copy path is invalid.",
      );
    }
    const resolved = resolveRelative(
      loaded.paths.controlRoot,
      relative,
      "preparedWorkingCopyRelativePath",
    );
    if (!pathInside(loaded.paths.transactionsRoot, resolved)) {
      throw new ProjectFileRepositoryError(
        "PATH_ESCAPES_PROJECT",
        "The Promotion prepared Working Copy must stay inside transactions/.",
      );
    }
    return resolved;
  }

  async #writePromotionTransaction(loaded, transactionRoot, transaction) {
    assertPromotionTransaction(transaction);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      path.join(transactionRoot, "transaction.json"),
      transaction,
      "promotion transaction",
    );
  }

  async #reallocateUnstartedPromotion(loaded, transactionRoot, transaction) {
    if (!["prepared", "snapshot-created"].includes(transaction.state)) return false;
    const finalPath = path.join(
      loaded.paths.projectRootPath,
      topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath),
    );
    const information = await lstat(finalPath).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (!information) return false;
    const next = await this.#allocatePromotionWorkingCopy(loaded, {
      preferredFileStem: transaction.preferredFileStem,
      preferredExtension: transaction.preferredExtension,
      versionOrdinal: transaction.versionOrdinal,
      startAt: transaction.pathAllocationOrdinal + 1,
    });
    transaction.finalWorkingCopyRelativePath = next.sourceRelativePath;
    transaction.pathAllocationOrdinal = next.allocationOrdinal;
    transaction.reallocatedAt = nowIso(this.#clock);
    await this.#writePromotionTransaction(loaded, transactionRoot, transaction);
    return true;
  }

  async #promoteCandidate({ target, candidateId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const candidateState = await this.#readCandidateForLoaded(loaded, candidateId);
    await this.#assertCandidateSourceCurrent(loaded, candidateState.candidate);
    const transactionId = "promote_" + candidateState.candidate.candidateId;
    const transactionRoot = path.join(loaded.paths.transactionsRoot, transactionId);
    const transactionPath = path.join(transactionRoot, "transaction.json");
    let transaction = await readJsonFile(transactionPath, "promotion transaction", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!transaction) {
      await ensureProjectDirectory(
        loaded.paths.projectRootPath,
        transactionRoot,
        "Promotion transaction directory",
      );
      const preferredFileStem = assertPreferredFileStem(
        loaded.workingCopy.preferredFileStem,
      );
      const preferredExtension = htmlExtension(
        "x" + String(loaded.workingCopy.preferredExtension || ""),
      );
      const allocation = await this.#allocatePromotionWorkingCopy(loaded, {
        preferredFileStem,
        preferredExtension,
        versionOrdinal: candidateState.candidate.proposedVersionOrdinal,
      });
      transaction = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        kind: "promotion",
        state: "prepared",
        transactionId,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        candidateId: candidateState.candidate.candidateId,
        requestId: candidateState.candidate.requestId,
        versionId: candidateState.candidate.proposedVersionId,
        versionOrdinal: candidateState.candidate.proposedVersionOrdinal,
        candidateOutputSha256: candidateState.candidate.outputSha256,
        basedOnVersionId: candidateState.candidate.basedOnVersionId,
        previousVersionId: candidateState.candidate.previousVersionId,
        finalWorkingCopyRelativePath: allocation.sourceRelativePath,
        preparedWorkingCopyRelativePath: "transactions/" + transactionId
          + "/prepared-working-copy" + preferredExtension,
        preferredFileStem,
        preferredExtension,
        pathAllocationOrdinal: allocation.allocationOrdinal,
        preparedWorkingCopyFileIdentity: null,
        workingCopy: null,
        createdAt: nowIso(this.#clock),
      };
      await this.#writePromotionTransaction(loaded, transactionRoot, transaction);
      await this.#hit("promotion-prepared", { transactionPath });
    }
    return this.#continuePromotion(loaded, candidateState, transactionRoot, transaction);
  }

  async #assertCandidateSourceCurrent(loaded, candidate) {
    const sourceWorkingCopyId = assertId(
      candidate.sourceWorkingCopyId,
      WORKING_COPY_ID,
      "Candidate sourceWorkingCopyId",
    );
    const expectedSourceSha256 = assertSha256(
      candidate.expectedSourceSha256,
      "Candidate expectedSourceSha256",
    );
    const sourceWorkingCopy = loaded.manifest.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === sourceWorkingCopyId,
    );
    if (!sourceWorkingCopy) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_WORKING_COPY_MISSING",
        "The Candidate source Working Copy is no longer available.",
        { candidateId: candidate.candidateId, sourceWorkingCopyId },
      );
    }
    const source = await readHtmlFile(
      workingCopySourcePath(loaded.paths, sourceWorkingCopy),
      "Candidate Working Copy",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (source.sha256 !== expectedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_SOURCE_CHANGED",
        "The Working Copy changed after Candidate validation and cannot be adopted yet.",
        {
          expectedSourceSha256,
          actualSourceSha256: source.sha256,
          candidateId: candidate.candidateId,
          sourceWorkingCopyId,
        },
      );
    }
    return source;
  }

  async #continuePromotion(loaded, candidateState, transactionRoot, transaction) {
    assertPromotionTransaction(transaction);
    assertPromotionCandidateBinding(transaction, candidateState.candidate);
    if (
      !isObject(transaction)
      || transaction.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || transaction.kind !== "promotion"
      || ![
        "prepared",
        "snapshot-created",
        "working-copy-prepared",
        "working-copy-created",
        "manifest-committed",
        "completed",
      ].includes(transaction.state)
      || transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
      || transaction.candidateId !== candidateState.candidate.candidateId
      || transaction.candidateOutputSha256 !== candidateState.candidate.outputSha256
    ) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_TRANSACTION_MISMATCH",
        "The Promotion transaction belongs to another Candidate.",
      );
    }
    topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath);
    assertPreferredFileStem(transaction.preferredFileStem);
    if (!HTML_EXTENSIONS.has(transaction.preferredExtension)) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_TRANSACTION_INVALID",
        "The Promotion preferred extension is invalid.",
      );
    }
    if (
      !Number.isSafeInteger(transaction.pathAllocationOrdinal)
      || transaction.pathAllocationOrdinal < 0
    ) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_TRANSACTION_INVALID",
        "The Promotion path allocation is invalid.",
      );
    }
    const latest = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    if (
      latest.versionId !== transaction.previousVersionId
      || transaction.versionId !== versionId(latest.ordinal + 1)
    ) {
      if (loaded.manifest.versions.some((version) => version.versionId === transaction.versionId)) {
        return this.#finishPromotedCandidate(loaded, candidateState, transactionRoot, transaction);
      }
      throw new ProjectFileRepositoryError(
        "STALE_CANDIDATE",
        "The latest formal Version changed before this Candidate was adopted.",
      );
    }
    if (candidateState.candidate.status !== "pending-review") {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_NOT_PENDING_REVIEW",
        "Only a pending-review Candidate can be adopted.",
      );
    }
    const version = {
      versionId: transaction.versionId,
      ordinal: transaction.versionOrdinal,
      basedOnVersionId: transaction.basedOnVersionId,
      previousVersionId: transaction.previousVersionId,
      contentSha256: transaction.candidateOutputSha256,
      snapshotRelativePath: "versions/" + transaction.versionId + "/index.html",
      sourceRequestId: transaction.requestId,
      sourceCandidateId: transaction.candidateId,
      createdAt: transaction.createdAt,
    };
    const snapshotPath = versionSnapshotPath(loaded.paths, version);
    if (transaction.state === "prepared") {
      await ensureProjectDirectory(
        loaded.paths.projectRootPath,
        path.dirname(snapshotPath),
        "Version snapshot directory",
      );
      await writeFileNoReplace(
        snapshotPath,
        candidateState.output.buffer,
        transaction.candidateOutputSha256,
        "Version snapshot",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      transaction.state = "snapshot-created";
      transaction.snapshotCreatedAt = nowIso(this.#clock);
      await this.#writePromotionTransaction(loaded, transactionRoot, transaction);
      await this.#hit("promotion-snapshot-created", { transactionRoot });
    }
    await this.#reallocateUnstartedPromotion(loaded, transactionRoot, transaction);
    const preparedPath = this.#preparedPromotionWorkingCopyPath(loaded, transaction);
    if (transaction.state === "snapshot-created") {
      let preparedInformation = await regularInformation(
        preparedPath,
        "prepared Version Working Copy",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (preparedInformation) {
        if (
          !transaction.preparedWorkingCopyFileIdentity
          || !sameFileIdentity(
            transaction.preparedWorkingCopyFileIdentity,
            copyFileIdentity(preparedInformation),
          )
        ) {
          throw new ProjectFileRepositoryError(
            "PROMOTION_PREPARED_PATH_CONFLICT",
            "The Promotion preparation path is already occupied.",
          );
        }
      } else {
        const prepared = await writeFileNoReplace(
          preparedPath,
          candidateState.output.buffer,
          transaction.candidateOutputSha256,
          "prepared Version Working Copy",
          { projectRootPath: loaded.paths.projectRootPath },
        );
        if (!prepared.created) {
          throw new ProjectFileRepositoryError(
            "PROMOTION_PREPARED_PATH_CONFLICT",
            "The Promotion preparation path is already occupied.",
          );
        }
        preparedInformation = prepared.information;
      }
      transaction.preparedWorkingCopyFileIdentity = copyFileIdentity(preparedInformation);
      transaction.state = "working-copy-prepared";
      transaction.workingCopyPreparedAt = nowIso(this.#clock);
      await this.#writePromotionTransaction(loaded, transactionRoot, transaction);
      await this.#hit("promotion-working-copy-prepared", { transactionRoot });
    }
    if (transaction.state === "working-copy-prepared") {
      const preparedInformation = await regularInformation(
        preparedPath,
        "prepared Version Working Copy",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (
        !preparedInformation
        || !transaction.preparedWorkingCopyFileIdentity
        || !sameFileIdentity(
          transaction.preparedWorkingCopyFileIdentity,
          copyFileIdentity(preparedInformation),
        )
      ) {
        throw new ProjectFileRepositoryError(
          "PROMOTION_PREPARED_FILE_CHANGED",
          "The Promotion preparation file changed before publication.",
        );
      }
      const visiblePath = path.join(
        loaded.paths.projectRootPath,
        topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath),
      );
      let visibleInformation = await lstat(visiblePath).catch((cause) => {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      });
      if (!visibleInformation) {
        try {
          await link(preparedPath, visiblePath);
          await syncDirectory(loaded.paths.projectRootPath);
        } catch (cause) {
          if (cause?.code !== "EEXIST") throw cause;
        }
        visibleInformation = await lstat(visiblePath).catch((cause) => {
          if (cause?.code === "ENOENT") return null;
          throw cause;
        });
      }
      if (
        !visibleInformation
        || visibleInformation.isSymbolicLink()
        || !visibleInformation.isFile()
        || !sameFileIdentity(
          transaction.preparedWorkingCopyFileIdentity,
          copyFileIdentity(visibleInformation),
        )
      ) {
        throw new ProjectFileRepositoryError(
          "PROMOTION_PATH_REPLACED",
          "The allocated Version Working Copy path is no longer owned by this Promotion.",
          { sourceRelativePath: transaction.finalWorkingCopyRelativePath },
        );
      }
      const nextWorkingCopy = {
        workingCopyId: workingCopyId(version.ordinal),
        versionId: version.versionId,
        basedOnVersionId: version.versionId,
        sourceRelativePath: transaction.finalWorkingCopyRelativePath,
        preferredFileStem: transaction.preferredFileStem,
        preferredExtension: transaction.preferredExtension,
        stateRelativePath: "working-copies/" + workingCopyId(version.ordinal) + ".json",
        fileIdentity: copyFileIdentity(visibleInformation),
      };
      const statePath = workingCopyStatePath(loaded.paths, nextWorkingCopy);
      await atomicWriteProjectJson(loaded.paths.projectRootPath, statePath, {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        workingCopyId: nextWorkingCopy.workingCopyId,
        basedOnVersionId: version.versionId,
        baseSha256: transaction.candidateOutputSha256,
        currentSha256: transaction.candidateOutputSha256,
        differsFromBase: false,
        draftId: "draft_" + nextWorkingCopy.workingCopyId,
        draftRelativePath: draftRelativePathFor(nextWorkingCopy),
        draftSha256: null,
        draftRevision: 0,
        saveState: "saved",
        lastPersistedRevision: 0,
        lastSavedAt: nowIso(this.#clock),
        lastOpenedAt: nowIso(this.#clock),
      }, "Version Working Copy state");
      transaction.state = "working-copy-created";
      transaction.workingCopyCreatedAt = nowIso(this.#clock);
      transaction.workingCopy = nextWorkingCopy;
      await this.#writePromotionTransaction(loaded, transactionRoot, transaction);
      await this.#hit("promotion-working-copy-created", { transactionRoot });
    }
    if (transaction.state === "working-copy-created") {
      const committedWorkingCopy = transaction.workingCopy;
      if (!committedWorkingCopy) {
        throw new ProjectFileRepositoryError(
          "PROMOTION_WORKING_COPY_MISSING",
          "The Promotion did not record its Working Copy.",
        );
      }
      const visiblePath = path.join(
        loaded.paths.projectRootPath,
        topLevelHtmlRelativePath(committedWorkingCopy.sourceRelativePath),
      );
      const information = await regularInformation(visiblePath, "Version Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (
        !information
        || !sameFileIdentity(committedWorkingCopy.fileIdentity, copyFileIdentity(information))
      ) {
        throw new ProjectFileRepositoryError(
          "PROMOTION_PATH_REPLACED",
          "The allocated Version Working Copy was replaced before manifest publication.",
        );
      }
      // Recovery enters #continuePromotion directly, so this must be the
      // shared commit boundary rather than a check only at adoption start.
      await this.#assertCandidateSourceCurrent(loaded, candidateState.candidate);
      loaded.manifest.versions.push(version);
      loaded.manifest.workingCopies.push(committedWorkingCopy);
      loaded.manifest.latestOfficialVersionId = version.versionId;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.manifestPath,
        loaded.manifest,
        "manifest.json",
      );
      transaction.state = "manifest-committed";
      transaction.manifestCommittedAt = nowIso(this.#clock);
      await this.#writePromotionTransaction(loaded, transactionRoot, transaction);
      await this.#hit("promotion-manifest-committed", { transactionRoot });
    }
    return this.#finishPromotedCandidate(loaded, candidateState, transactionRoot, transaction);
  }

  async #finishPromotedCandidate(loaded, candidateState, transactionRoot, transaction) {
    const committedVersion = loaded.manifest.versions.find(
      (version) => version.versionId === transaction.versionId,
    );
    if (!committedVersion) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_VERSION_MISSING",
        "The Promotion did not publish its Version manifest.",
      );
    }
    const committedWorkingCopy = loaded.manifest.workingCopies.find(
      (workingCopy) => workingCopy.versionId === committedVersion.versionId,
    );
    if (!committedWorkingCopy) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_WORKING_COPY_MISSING",
        "The Promotion did not publish its Working Copy mapping.",
      );
    }
    if (transaction.state !== "completed") {
      candidateState.candidate.status = "promoted";
      candidateState.candidate.promotedAt = nowIso(this.#clock);
      candidateState.candidate.promotedVersionId = committedVersion.versionId;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        candidateState.candidatePath,
        candidateState.candidate,
        "candidate.json",
      );
      // Candidate and Request are separate durable facts. Preserve an
      // explicit recovery boundary here: on restart, #recoverProject resumes
      // the Promotion before it validates Request/runtime consistency.
      await this.#hit("promotion-candidate-promoted", { transactionRoot });
      const requestPath = path.join(
        requestRootPath(loaded.paths, candidateState.candidate.requestId),
        "request.json",
      );
      const request = await readJsonFile(requestPath, "request.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (request?.candidateId === candidateState.candidate.candidateId) {
        request.status = "promoted";
        request.promotedVersionId = committedVersion.versionId;
        request.promotedAt = nowIso(this.#clock);
        await atomicWriteProjectJson(
          loaded.paths.projectRootPath,
          requestPath,
          request,
          "request.json",
        );
      }
      loaded.runtime.activeWorkingCopyId = committedWorkingCopy.workingCopyId;
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.runtimePath,
        loaded.runtime,
        "runtime-state.json",
      );
      transaction.state = "completed";
      transaction.completedAt = nowIso(this.#clock);
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        path.join(transactionRoot, "transaction.json"),
        transaction,
        "promotion transaction",
      );
      await this.#hit("promotion-completed", { transactionRoot });
    }
    const sourcePath = workingCopySourcePath(loaded.paths, committedWorkingCopy);
    const source = await readHtmlFile(sourcePath, "Version Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    return {
      promoted: true,
      version: committedVersion,
      target: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: committedWorkingCopy,
        version: committedVersion,
        exactSourcePath: sourcePath,
        sourceSha256: source.sha256,
      }),
    };
  }

  async #recoverSaveTransaction(loaded, transactionPath, transaction) {
    if (
      !isObject(transaction)
      || transaction.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || transaction.kind !== "save"
      || !["prepared", "source-staged", "source-published", "committed"].includes(transaction.state)
      || transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
    ) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_INVALID",
        "The Working Copy save transaction is invalid.",
      );
    }
    const id = assertId(transaction.workingCopyId, WORKING_COPY_ID, "workingCopyId");
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === id,
    );
    if (!workingCopy || transaction.sourceRelativePath !== workingCopy.sourceRelativePath) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_IDENTITY_MISMATCH",
        "The Working Copy save transaction no longer matches manifest.json.",
      );
    }
    const expected = assertSha256(
      transaction.expectedSourceSha256,
      "save transaction expectedSourceSha256",
    );
    const target = assertSha256(
      transaction.targetSourceSha256,
      "save transaction targetSourceSha256",
    );
    const sourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    const hasSourceGuard = (
      transaction.sourceGuardRelativePath !== undefined
      || transaction.sourceReplacementRelativePath !== undefined
    );
    if (
      !hasSourceGuard
      && ["source-staged", "source-published"].includes(transaction.state)
    ) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_INVALID",
        "The Working Copy save transaction is missing its source guard.",
      );
    }
    const artifacts = hasSourceGuard
      ? saveTransactionArtifactPaths(loaded.paths, transactionPath, transaction)
      : null;
    let source;
    try {
      source = await readHtmlFile(sourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
    } catch (cause) {
      if (cause?.code !== "SOURCE_NOT_FOUND") throw cause;
      source = null;
    }
    let sourceGuard = null;
    if (artifacts) {
      const guardInformation = await regularInformation(
        artifacts.sourceGuardPath,
        "save source guard",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      sourceGuard = guardInformation
        ? await readHtmlFile(artifacts.sourceGuardPath, "save source guard", {
          projectRootPath: loaded.paths.projectRootPath,
        })
        : null;
      if (!source && sourceGuard) {
        try {
          await link(artifacts.sourceGuardPath, sourcePath);
        } catch (cause) {
          if (cause?.code !== "EEXIST") throw cause;
        }
        source = await readHtmlFile(sourcePath, "Working Copy", {
          projectRootPath: loaded.paths.projectRootPath,
        });
      }
      if (sourceGuard && sourceGuard.sha256 !== expected) {
        throw new ProjectFileRepositoryError(
          "SAVE_RECOVERY_CONFLICT",
          "The Working Copy changed through an already-open external file handle during save recovery.",
          {
            workingCopyId: workingCopy.workingCopyId,
            expectedSourceSha256: expected,
            actualSourceSha256: sourceGuard.sha256,
          },
        );
      }
    }
    if (!source) {
      throw new ProjectFileRepositoryError(
        "SAVE_RECOVERY_CONFLICT",
        "The Working Copy is missing during an interrupted save.",
        { workingCopyId: workingCopy.workingCopyId },
      );
    }
    const statePath = workingCopyStatePath(loaded.paths, workingCopy);
    const currentState = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!currentState) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The Working Copy state is missing during save recovery.",
      );
    }
    assertWorkingCopyState(currentState, loaded.project, workingCopy);
    if (source.sha256 === target) {
      if (artifacts) {
        await Promise.all([
          unlinkIfPresent(artifacts.sourceGuardPath),
          unlinkIfPresent(artifacts.sourceReplacementPath),
        ]);
        await syncDirectory(loaded.paths.transactionsRoot);
      }
      const revision = Number.isSafeInteger(Number(transaction.editRevision))
        && Number(transaction.editRevision) >= 0
        ? Number(transaction.editRevision)
        : Number(currentState.lastPersistedRevision || 0);
      workingCopy.fileIdentity = copyFileIdentity(source.information);
      const savedAt = String(transaction.committedAt || transaction.preparedAt || nowIso(this.#clock));
      await atomicWriteProjectJson(loaded.paths.projectRootPath, statePath, {
        ...currentState,
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        workingCopyId: workingCopy.workingCopyId,
        currentSha256: target,
        differsFromBase: target !== currentState.baseSha256,
        saveState: "saved",
        lastPersistedRevision: Math.max(
          Number(currentState.lastPersistedRevision || 0),
          revision,
        ),
        lastSavedAt: savedAt,
      }, "Working Copy state");
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.manifestPath,
        loaded.manifest,
        "manifest.json",
      );
      if (transaction.state !== "committed") {
        await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
          ...transaction,
          state: "committed",
          committedAt: nowIso(this.#clock),
          recoveredAt: nowIso(this.#clock),
        }, "save transaction");
      }
      return {
        kind: "save",
        workingCopyId: workingCopy.workingCopyId,
        state: "committed",
      };
    }
    if (
      source.sha256 === expected
      && ["prepared", "source-staged"].includes(transaction.state)
    ) {
      if (artifacts) {
        await Promise.all([
          unlinkIfPresent(artifacts.sourceGuardPath),
          unlinkIfPresent(artifacts.sourceReplacementPath),
        ]);
        await syncDirectory(loaded.paths.transactionsRoot);
      }
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
        ...transaction,
        state: "committed",
        committedAt: nowIso(this.#clock),
        recovery: "source-unchanged",
      }, "save transaction");
      return {
        kind: "save",
        workingCopyId: workingCopy.workingCopyId,
        state: "rolled-back",
      };
    }
    throw new ProjectFileRepositoryError(
      "SAVE_RECOVERY_CONFLICT",
      "The Working Copy changed during an interrupted save and was not overwritten.",
      {
        workingCopyId: workingCopy.workingCopyId,
        expectedSourceSha256: expected,
        targetSourceSha256: target,
        actualSourceSha256: source.sha256,
      },
    );
  }

  async #recoverRequestRuntime(loaded) {
    let entries;
    try {
      entries = await listProjectDirectory(
        loaded.paths.projectRootPath,
        loaded.paths.requestsRoot,
        "requests",
      );
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    }
    const activeRecords = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_REQUEST_ID.test(entry.name)) {
        continue;
      }
      const requestPath = path.join(loaded.paths.requestsRoot, entry.name, "request.json");
      const record = await readJsonFile(requestPath, "request.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!record) continue;
      const workingCopy = loaded.manifest.workingCopies.find(
        (candidate) => candidate.workingCopyId === record.sourceWorkingCopyId,
      );
      if (!workingCopy) continue;
      try {
        this.#assertRequestRecord(record, { ...loaded, workingCopy }, {
          requestId: entry.name,
          attemptId: record.attemptId,
        });
        await this.#assertSealedRequestIdentity({ ...loaded, workingCopy }, record);
      } catch {
        // A user-altered inactive Request is not repaired or used to infer
        // runtime state. Its explicit operation remains unavailable.
        continue;
      }
      if (["processing", "candidate-ready"].includes(record.status)) {
        activeRecords.push({ record, workingCopy });
      }
    }
    if (activeRecords.length > 1) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RECOVERY_AMBIGUOUS",
        "More than one unfinished AI Request exists; PageRoot will not guess which one is active.",
        { requestIds: activeRecords.map(({ record }) => record.requestId) },
      );
    }
    if (activeRecords.length === 0) {
      if (!loaded.runtime.activeRequest && !loaded.runtime.activeCandidateId) return null;
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.runtimePath,
        loaded.runtime,
        "runtime-state.json",
      );
      return { kind: "request-runtime", state: "cleared" };
    }
    const { record, workingCopy } = activeRecords[0];
    const restored = await this.#restoreRequestRuntime(
      { ...loaded, workingCopy },
      record,
    );
    return restored
      ? { kind: "request-runtime", requestId: record.requestId, state: record.status }
      : null;
  }

  async #recoverProject(projectRootPath) {
    const declaredProjectRootPath = normalizedPath(projectRootPath);
    const registry = await this.#readRegistry();
    const matched = Object.entries(registry.projects).find(([, record]) => (
      samePath(record.registeredProjectRootPath, declaredProjectRootPath)
    ));
    if (!matched) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "Recovery is limited to a Registry-authorized project root.",
        { projectRootPath: declaredProjectRootPath },
      );
    }
    const [projectId, record] = matched;
    const loaded = await this.#loadRegisteredProject({
      projectId,
      declaredProjectRootPath: record.registeredProjectRootPath,
    });
    const recovered = [];
    const entries = await listProjectDirectory(
      loaded.paths.projectRootPath,
      loaded.paths.transactionsRoot,
      "transactions",
    );
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name.startsWith("save_") && entry.name.endsWith(".json")) {
        const transactionPath = path.join(loaded.paths.transactionsRoot, entry.name);
        const transaction = await readJsonFile(transactionPath, "save transaction", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (transaction?.state !== "committed") {
          recovered.push(await this.#recoverSaveTransaction(
            loaded,
            transactionPath,
            transaction,
          ));
        }
        continue;
      }
      if (!entry.isDirectory() || !entry.name.startsWith("promote_")) continue;
      const transactionRoot = path.join(loaded.paths.transactionsRoot, entry.name);
      const transaction = await readJsonFile(
        path.join(transactionRoot, "transaction.json"),
        "promotion transaction",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (!transaction) continue;
      assertPromotionTransaction(transaction);
      if (transaction.state === "completed") continue;
      // transaction.json is recovery input, not authority. Resolve the
      // Candidate by its transaction-bound id rather than trusting its
      // requestId to construct a path; #continuePromotion then compares every
      // immutable linkage field before it can publish a Version.
      const candidateState = await this.#readCandidateForLoaded(
        loaded,
        transaction.candidateId,
      );
      recovered.push(await this.#continuePromotion(
        loaded,
        candidateState,
        transactionRoot,
        transaction,
      ));
    }
    // A crash after candidate.json becomes promoted but before request.json
    // follows leaves an intentional intermediate state. Finish every pending
    // Promotion first, then use Request facts to restore runtime state.
    const requestRuntime = await this.#recoverRequestRuntime(loaded);
    if (requestRuntime) recovered.push(requestRuntime);
    return recovered;
  }
}
