import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  realpath,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
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
import {
  AiTaskProjectionError,
  materializeAiTaskProjection,
} from "./ai-task-projection.mjs";

export const PROJECT_FILE_SCHEMA_VERSION = "4.0.0";

const serialPathCache = new AsyncLocalStorage();

async function cachedRealPath(target) {
  const store = serialPathCache.getStore();
  if (store?.realPaths.has(target)) return store.realPaths.get(target);
  const resolved = await realpath(target);
  store?.realPaths.set(target, resolved);
  return resolved;
}

async function verifiedProjectRoot(projectRoot, { allowMissing = true } = {}) {
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

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const CURRENT_REGISTRY_WRITE_LOCK_DIRECTORY = ".pageroot-registry-write-lock";
const CURRENT_REGISTRY_WRITE_LOCK_WAIT_MS = 20;
const CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS = 30_000;
const CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS = 10_000;
const CURRENT_REGISTRY_WRITE_LOCK_OWNER_FILE = /^\.owner-([a-f0-9-]{36})\.json$/u;
const CURRENT_REGISTRY_WRITE_LOCK_RETIRING_FILE =
  /^\.retiring-([a-f0-9-]{36})-([a-f0-9-]{36})\.json$/u;
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const VERSION_ID = /^ver_\d{4,}$/u;
const WORKING_COPY_ID = /^work_ver_\d{4,}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const SAFE_OPERATION_ID = /^[A-Za-z0-9_-]{8,160}$/u;
const RECONCILE_LOCATOR_REASONS = new Set([
  "watch",
  "rename",
  "startup",
  "safe-action",
]);
const SAVE_RECOVERY_ID = /^save_work_ver_\d{4,}_(?:current|\d+)_[a-f0-9]{32}$/u;
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const MAX_PATH_COMPONENT_BYTES = 255;
const WORKING_COPY_SAVE_STATES = new Set(["saved", "saving", "failed"]);
const IMPORT_STAGING_WRAPPER_BYTES = Buffer.byteLength(
  "..pageroot-import-00000000-0000-0000-0000-000000000000",
  "utf8",
);
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

function previewSnippet(value, maxLength = 500) {
  return String(value || "").replaceAll("\0", "").slice(0, maxLength);
}

function mapCandidateValidationError(cause) {
  const code = String(cause?.code || "");
  const message = String(cause?.message || "");
  if (code === "INCOMPLETE_HTML") {
    return {
      errorCode: "INCOMPLETE_HTML",
      message: message || "The Candidate HTML is incomplete.",
      errorDetail: "输出缺少完整 HTML 文档结构",
      recoveryHint: "请检查 AI Agent 的输出是否被截断，然后重新提交。",
    };
  }
  if (
    code === "CANDIDATE_HASH_MISMATCH"
    || code === "FROZEN_INPUT_HASH_MISMATCH"
    || code === "REQUEST_OUTPUT_CHANGED"
    || code === "HASH_MISMATCH"
  ) {
    return {
      errorCode: "HASH_MISMATCH",
      message: message || "The Candidate HTML hash did not match the sealed record.",
      errorDetail: "输出内容与声明的 Hash 不一致",
      recoveryHint: "请重新提交完整输出，不要改动校验字段。",
    };
  }
  if (code === "CANDIDATE_UNUSABLE" || code === "PROTOCOL_FIELD_MISSING") {
    return {
      errorCode: "PROTOCOL_FIELD_MISSING",
      message: message || "The Candidate HTML is unusable.",
      errorDetail: "输出缺少必要的协议字段或无法作为完整页面使用",
      recoveryHint: "请检查 AI Agent 的输出是否完整，然后重新提交。",
    };
  }
  return null;
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
  if (process.platform === "darwin" || process.platform === "win32") {
    return first.toLocaleLowerCase("en-US")
      === second.toLocaleLowerCase("en-US");
  }
  return first === second;
}

function pathInside(root, candidate, { allowRoot = false } = {}) {
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

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function truncateUtf8(value, maxBytes) {
  const normalized = String(value || "").normalize("NFC");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return "";
  let result = "";
  for (const character of normalized) {
    if (utf8ByteLength(result + character) > maxBytes) break;
    result += character;
  }
  return result.trim();
}

function filenameWithReservedSuffix(stem, suffix, extension, label, extraReservedBytes = 0) {
  const safeStem = assertPreferredFileStem(stem, label);
  const reservedBytes = utf8ByteLength(`${suffix}${extension}`) + extraReservedBytes;
  if (reservedBytes >= MAX_PATH_COMPONENT_BYTES) {
    throw new ProjectFileRepositoryError(
      "PATH_COMPONENT_TOO_LONG",
      `${label} has no remaining space for its required suffix.`,
    );
  }
  const truncated = truncateUtf8(safeStem, MAX_PATH_COMPONENT_BYTES - reservedBytes);
  if (!truncated) {
    throw new ProjectFileRepositoryError(
      "PATH_COMPONENT_TOO_LONG",
      `${label} has no remaining UTF-8 filename space.`,
    );
  }
  return `${truncated}${suffix}${extension}`;
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
  return filenameWithReservedSuffix(
    stem,
    ("-V" + ordinal).repeat(allocationOrdinal + 1),
    safeExtension,
    "Working Copy filename",
  );
}

function aiTaskCandidateFileName(stem, ordinal, extension) {
  const safeExtension = HTML_EXTENSIONS.has(String(extension || "").toLowerCase())
    ? String(extension).toLowerCase()
    : null;
  if (!safeExtension) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_EXTENSION",
      "Only .html and .htm files can be used for an AI task Candidate.",
    );
  }
  if (!Number.isSafeInteger(Number(ordinal)) || Number(ordinal) < 2) {
    throw new ProjectFileRepositoryError(
      "INVALID_CANDIDATE",
      "The AI task Candidate Version ordinal is invalid.",
    );
  }
  return filenameWithReservedSuffix(
    stem,
    `-V${Number(ordinal)}-待审阅`,
    safeExtension,
    "AI task Candidate filename",
  );
}

function projectDirectoryName(stem, ordinal) {
  const suffix = ordinal === 1 ? "" : ` (${ordinal})`;
  // Import first creates a hidden sibling staging directory. Reserve the
  // exact fixed marker (including a UUID) before choosing the eventual
  // project directory name so a valid UTF-8 source name cannot make staging
  // fail after the Registry intent is durable.
  return filenameWithReservedSuffix(
    stem,
    suffix,
    "",
    "project directory name",
    IMPORT_STAGING_WRAPPER_BYTES,
  );
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

async function readRegularFileWithSha256(filePath, label, options = {}) {
  const information = await regularInformation(filePath, label, options);
  if (!information) return null;
  const buffer = await readFile(filePath);
  return { buffer, information, sha256: sha256(buffer) };
}

async function linkFileNoReplace(sourcePath, filePath, expectedSha256, label, {
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

function saveRecoveryPaths(paths, workingCopyIdValue, revision, recoveryId) {
  const normalizedRevision = Number.isSafeInteger(Number(revision)) && Number(revision) >= 0
    ? Number(revision)
    : 0;
  const id = String(recoveryId || "");
  const prefix = `save_${assertId(workingCopyIdValue, WORKING_COPY_ID, "workingCopyId")}_${normalizedRevision || "current"}_`;
  if (!SAVE_RECOVERY_ID.test(id) || !id.startsWith(prefix)) {
    throw new ProjectFileRepositoryError(
      "SAVE_TRANSACTION_INVALID",
      "The Working Copy save recovery location is invalid.",
    );
  }
  const operationRoot = path.join(paths.recoveryRoot, id);
  if (!pathInside(paths.recoveryRoot, operationRoot)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "The Working Copy save recovery location escapes recovery/.",
    );
  }
  return {
    operationRoot,
    previousPath: path.join(operationRoot, "previous.html"),
    nextPath: path.join(operationRoot, "next.html"),
  };
}

async function compareAndSwapWorkingCopyFile({
  sourcePath,
  nextBuffer,
  expectedSha256,
  nextSha256,
  projectRootPath,
}) {
  const parent = path.dirname(sourcePath);
  await assertRealPathInsideProject(projectRootPath, parent, "Working Copy parent", {
    expectedKind: "directory",
  });
  const temporary = path.join(
    parent,
    `.pageroot-save-${process.pid}-${randomUUID()}.tmp`,
  );
  await atomicWriteFile(temporary, nextBuffer);
  let swapped = false;
  try {
    let currentBuffer;
    try {
      const information = await lstat(sourcePath);
      if (information.isSymbolicLink() || !information.isFile()) {
        throw new ProjectFileRepositoryError(
          "UNSAFE_FILE",
          "Working Copy must be a regular file, not a symbolic link.",
        );
      }
      currentBuffer = await readFile(sourcePath);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        return { swapped: false, actualSha256: null, written: null };
      }
      throw cause;
    }
    const actualSha256 = sha256(currentBuffer);
    if (actualSha256 !== expectedSha256) {
      return { swapped: false, actualSha256, written: null };
    }
    await rename(temporary, sourcePath);
    swapped = true;
    await syncDirectory(parent);
  } finally {
    if (!swapped) await rm(temporary, { force: true }).catch(() => {});
  }

  const writtenBuffer = await readFile(sourcePath);
  const writtenSha256 = sha256(writtenBuffer);
  if (writtenSha256 !== nextSha256) {
    throw new ProjectFileRepositoryError(
      "SOURCE_HASH_CONFLICT",
      "The Working Copy changed while PageRoot was verifying its save.",
      { expectedSourceSha256: nextSha256, actualSourceSha256: writtenSha256 },
    );
  }
  const information = await lstat(sourcePath);
  return {
    swapped: true,
    actualSha256: writtenSha256,
    written: {
      buffer: writtenBuffer,
      html: decodeHtml(writtenBuffer, "Working Copy"),
      sha256: writtenSha256,
      information,
    },
  };
}

async function atomicWriteProjectFile(projectRootPath, filePath, content, label) {
  await assertRealPathInsideProject(
    projectRootPath,
    path.dirname(filePath),
    `${label} parent`,
    { expectedKind: "directory" },
  );
  await atomicWriteFile(filePath, content);
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

function emptyRegistry(clock) {
  return {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    updatedAt: nowIso(clock),
    projects: {},
    pendingImports: {},
  };
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function localProcessIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM still proves that a local process owns this PID.  Only ESRCH is
    // safe evidence that a crashed migration owner can no longer publish.
    return cause?.code !== "ESRCH";
  }
}

// A lock directory whose ownership cannot be resolved is not a held lock.  It is
// the residue of a process that died between `mkdir` and its owner write, of a
// retire that died between its two renames, or of an owner file whose bytes were
// damaged.  None of those shapes can ever become resolvable again, so without a
// bounded exit every future acquisition would fail busy forever and no restart
// would help.
//
// A lease read can also come back unresolved for a purely transient reason: a
// live owner may be mid-release or mid-retire while its marker is renamed.  The
// two cases are separated by age, not by shape — a transient rename completes in
// microseconds, while crash residue keeps the same unresolvable directory for as
// long as it exists.  Reclaim therefore requires the directory to be older than
// the grace period, and re-proves both the directory identity and the still
// unresolved lease immediately before moving it.
//
// Age deliberately ignores `ctimeMs`: inode metadata is bumped by unrelated
// touches (backup and indexing tools, `chmod`, `utimes`), so including it would
// let any such touch reset the age and restore the permanent-busy behavior this
// reclaim exists to remove.  Creation and content timestamps only move when this
// lock is actually created or written.
async function reclaimUnresolvableLockDirectory({
  projectsRoot,
  lockPath,
  label,
  observed,
  readLease,
  graceMs,
  now = Date.now,
  onBeforeReclaim = null,
}) {
  const lastActivityMs = Math.max(
    Number(observed?.birthtimeMs || 0),
    Number(observed?.mtimeMs || 0),
  );
  if (!lastActivityMs || now() - lastActivityMs <= graceMs) return false;

  const current = await directoryInformation(lockPath, label, {
    projectRootPath: projectsRoot,
  });
  if (!current) return false;
  // A replacement lock created at the same path is a different directory.
  if (
    String(current.dev) !== String(observed.dev)
    || String(current.ino) !== String(observed.ino)
  ) return false;
  // A mid-flight release or retire may have completed since the first read.
  if (await readLease()) return false;

  await onBeforeReclaim?.({ lockPath, lastActivityMs });
  const abandonedPath = path.join(
    projectsRoot,
    `.pageroot-lock-unresolvable-${randomUUID()}`,
  );
  try {
    await rename(lockPath, abandonedPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  await rm(abandonedPath, { recursive: true, force: true });
  await syncDirectory(projectsRoot);
  return true;
}

function currentRegistryWriteLockPath(projectsRoot) {
  return path.join(projectsRoot, CURRENT_REGISTRY_WRITE_LOCK_DIRECTORY);
}

function currentRegistryWriteLockOwnerPath(lockPath, token) {
  return path.join(lockPath, `.owner-${token}.json`);
}

function currentRegistryWriteLockRetiringPath(lockPath, ownerToken) {
  return path.join(lockPath, `.retiring-${ownerToken}-${randomUUID()}.json`);
}

function currentRegistryWriteLockMarker(name) {
  const owner = String(name || "").match(CURRENT_REGISTRY_WRITE_LOCK_OWNER_FILE);
  if (owner) return { ownerToken: owner[1] };
  const retiring = String(name || "").match(CURRENT_REGISTRY_WRITE_LOCK_RETIRING_FILE);
  if (retiring) return { ownerToken: retiring[1] };
  return null;
}

function currentRegistryWriteLockOwner(value) {
  if (
    !hasExactKeys(value, ["createdAt", "pid", "token"])
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || typeof value.token !== "string"
    || !/^[a-f0-9-]{36}$/u.test(value.token)
    || !value.createdAt
    || Number.isNaN(Date.parse(value.createdAt))
  ) return null;
  return value;
}

async function currentRegistryWriteLockLease({ projectsRoot, lockPath }) {
  let entries;
  try {
    entries = await readdir(lockPath, { withFileTypes: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
  const markers = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, marker: currentRegistryWriteLockMarker(entry.name) }))
    .filter((entry) => entry.marker);
  if (markers.length !== 1) return null;
  const marker = markers[0];
  const ownerPath = path.join(lockPath, marker.name);
  let ownerRecord;
  try {
    ownerRecord = await readJsonFile(
      ownerPath,
      "current Registry write lock",
      { projectRootPath: projectsRoot },
    );
  } catch (cause) {
    if (
      cause?.code === "ENOENT"
      || (
        cause instanceof ProjectFileRepositoryError
        && cause.code === "INVALID_JSON"
      )
    ) return null;
    throw cause;
  }
  const owner = currentRegistryWriteLockOwner(ownerRecord);
  if (!owner || owner.token !== marker.marker.ownerToken) return null;
  return { owner, ownerPath };
}

async function releaseCurrentRegistryWriteLock({
  projectsRoot,
  lockPath,
  token,
}) {
  try {
    const ownerPath = currentRegistryWriteLockOwnerPath(lockPath, token);
    const owner = currentRegistryWriteLockOwner(await readJsonFile(
      ownerPath,
      "current Registry write lock",
      { projectRootPath: projectsRoot },
    ));
    if (!owner || owner.token !== token) return;
    await unlink(ownerPath).catch((cause) => {
      if (cause?.code !== "ENOENT") throw cause;
    });
    await rmdir(lockPath).catch((cause) => {
      if (cause?.code !== "ENOENT" && cause?.code !== "ENOTEMPTY") throw cause;
    });
  } catch (cause) {
    if (cause?.code === "ENOENT") return;
    throw cause;
  }
}

async function retireCurrentRegistryWriteLock({
  projectsRoot,
  lockPath,
  ownerPath,
  ownerToken,
}) {
  const retiringPath = currentRegistryWriteLockRetiringPath(lockPath, ownerToken);
  try {
    await rename(ownerPath, retiringPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  const abandonedPath = path.join(
    projectsRoot,
    `.pageroot-registry-write-stale-${randomUUID()}`,
  );
  try {
    await rename(lockPath, abandonedPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  await rm(abandonedPath, { recursive: true, force: true });
  await syncDirectory(projectsRoot);
  return true;
}

function waitForCurrentRegistryWriteLock() {
  return new Promise((resolve) => {
    setTimeout(resolve, CURRENT_REGISTRY_WRITE_LOCK_WAIT_MS);
  });
}

async function acquireCurrentRegistryWriteLock({
  projectsRoot,
  timeoutMs = CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS,
  graceMs = CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS,
  now = Date.now,
  onBeforeRetire = null,
}) {
  const lockPath = currentRegistryWriteLockPath(projectsRoot);
  const deadlineAt = Date.now() + timeoutMs;

  await assertRealPathInsideProject(projectsRoot, lockPath, "current Registry write lock");
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await assertRealPathInsideProject(
        projectsRoot,
        lockPath,
        "current Registry write lock",
        { expectedKind: "directory" },
      );
      const token = randomUUID();
      const ownerPath = currentRegistryWriteLockOwnerPath(lockPath, token);
      await atomicWriteFile(ownerPath, Buffer.from(jsonText({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      }), "utf8"), { mode: 0o600 });
      await Promise.all([
        syncDirectory(lockPath),
        syncDirectory(projectsRoot),
      ]);
      return () => releaseCurrentRegistryWriteLock({
        projectsRoot,
        lockPath,
        token,
      });
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
    }

    const lockInformation = await directoryInformation(
      lockPath,
      "current Registry write lock",
      { projectRootPath: projectsRoot },
    );
    if (!lockInformation) continue;
    const lease = await currentRegistryWriteLockLease({ projectsRoot, lockPath });
    if (lease && !localProcessIsAlive(lease.owner.pid)) {
      await onBeforeRetire?.({
        lockPath,
        ownerPath: lease.ownerPath,
        owner: lease.owner,
      });
      await retireCurrentRegistryWriteLock({
        projectsRoot,
        lockPath,
        ownerPath: lease.ownerPath,
        ownerToken: lease.owner.token,
      });
      continue;
    }
    if (!lease && await reclaimUnresolvableLockDirectory({
      projectsRoot,
      lockPath,
      label: "current Registry write lock",
      observed: lockInformation,
      readLease: () => currentRegistryWriteLockLease({ projectsRoot, lockPath }),
      graceMs,
      now,
      onBeforeReclaim: (details) => onBeforeRetire?.({
        ...details,
        ownerPath: null,
        owner: null,
      }),
    })) continue;
    if (Date.now() >= deadlineAt) {
      throw new ProjectFileRepositoryError(
        "REGISTRY_BUSY",
        "The project Registry is occupied. A lock left behind by an interrupted PageRoot process is reclaimed automatically after a short grace period.",
      );
    }
    await waitForCurrentRegistryWriteLock();
  }
}

function assertRegistryTimestamp(value, label) {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      label + " must be an RFC 3339 timestamp.",
    );
  }
  return value;
}

function assertRegistryProjectRecord(projectId, record) {
  if (
    !isObject(record)
    || Object.keys(record).some((key) => ![
      "registeredProjectRootPath",
      "rootFileIdentity",
      "updatedAt",
      "importSourceKey",
      "importSourceSha256",
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
  if (
    Object.hasOwn(record, "importSourceKey") !== Object.hasOwn(record, "importSourceSha256")
    || (
      Object.hasOwn(record, "importSourceKey")
      && (
        !SHA256.test(String(record.importSourceKey || ""))
        || !SHA256.test(String(record.importSourceSha256 || ""))
      )
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The registered import provenance is invalid.",
      { projectId },
    );
  }
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
      "importSourceKey",
      "importSourceSha256",
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
  if (
    Object.hasOwn(record, "importSourceKey") !== Object.hasOwn(record, "importSourceSha256")
    || (
      Object.hasOwn(record, "importSourceKey")
      && (
        !SHA256.test(String(record.importSourceKey || ""))
        || !SHA256.test(String(record.importSourceSha256 || ""))
      )
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The pending import provenance is invalid.",
      { projectId },
    );
  }
  return record;
}

function assertRegistry(registry) {
  if (
    !isObject(registry)
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
  if (!isObject(project) || project.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_PROJECT_SCHEMA",
      "project.json is not a supported PageRoot project identity.",
    );
  }
  assertId(project.projectId, PROJECT_ID, "projectId");
  assertId(project.documentId, DOCUMENT_ID, "documentId");
  if (!project.createdAt || Number.isNaN(Date.parse(project.createdAt))) {
    throw new ProjectFileRepositoryError("INVALID_PROJECT_IDENTITY", "project.json has no valid createdAt.");
  }
  return project;
}

function assertManifest(manifest, project) {
  if (!isObject(manifest) || manifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
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
  ) {
    throw new ProjectFileRepositoryError(
      "MANIFEST_IDENTITY_MISMATCH",
      "manifest.json does not match project.json.",
    );
  }
  const versionIds = new Set();
  for (const version of manifest.versions) {
    if (!isObject(version)) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Version entry is invalid.");
    }
    assertId(version.versionId, VERSION_ID, "versionId");
    if (
      !Number.isSafeInteger(version.ordinal)
      || version.ordinal < 1
      || version.versionId !== versionId(version.ordinal)
      || versionIds.has(version.versionId)
      || !SHA256.test(String(version.contentSha256 || ""))
    ) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Version entry is inconsistent.");
    }
    versionIds.add(version.versionId);
    ensureRelativePath(version.snapshotRelativePath, "snapshotRelativePath");
  }
  if (!versionIds.has(manifest.latestOfficialVersionId)) {
    throw new ProjectFileRepositoryError("INVALID_MANIFEST", "latestOfficialVersionId is unknown.");
  }
  const workingCopyIds = new Set();
  const workingCopyPaths = new Set();
  for (const workingCopy of manifest.workingCopies) {
    if (!isObject(workingCopy)) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Working Copy entry is invalid.");
    }
    assertId(workingCopy.workingCopyId, WORKING_COPY_ID, "workingCopyId");
    if (
      workingCopyIds.has(workingCopy.workingCopyId)
      || !versionIds.has(workingCopy.basedOnVersionId)
      || !versionIds.has(workingCopy.versionId)
    ) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Working Copy entry is inconsistent.");
    }
    const sourceRelativePath = topLevelHtmlRelativePath(
      workingCopy.sourceRelativePath,
      "sourceRelativePath",
    );
    if (workingCopyPaths.has(sourceRelativePath)) {
      throw new ProjectFileRepositoryError(
        "INVALID_MANIFEST",
        "Working Copy source paths must be unique.",
      );
    }
    workingCopyPaths.add(sourceRelativePath);
    assertPreferredFileStem(workingCopy.preferredFileStem);
    if (!HTML_EXTENSIONS.has(String(workingCopy.preferredExtension || "").toLowerCase())) {
      throw new ProjectFileRepositoryError(
        "INVALID_MANIFEST",
        "A Working Copy preferred extension is invalid.",
      );
    }
    ensureRelativePath(workingCopy.stateRelativePath, "stateRelativePath");
    assertFileIdentity(workingCopy.fileIdentity, "Working Copy fileIdentity");
    workingCopyIds.add(workingCopy.workingCopyId);
  }
  return manifest;
}

function assertHistoryActivation(runtime, project, manifest) {
  const activation = runtime.historyActivation;
  if (activation === undefined || activation === null) return null;
  if (
    !hasExactKeys(activation, [
      "activatedWorkingCopyId",
      "createdAt",
      "documentId",
      "operationId",
      "previousWorkingCopyId",
      "projectId",
      "state",
      "versionId",
    ])
    || activation.projectId !== project.projectId
    || activation.documentId !== project.documentId
    || !SAFE_OPERATION_ID.test(String(activation.operationId || ""))
    || !VERSION_ID.test(String(activation.versionId || ""))
    || !WORKING_COPY_ID.test(String(activation.activatedWorkingCopyId || ""))
    || (
      activation.previousWorkingCopyId !== null
      && !WORKING_COPY_ID.test(String(activation.previousWorkingCopyId || ""))
    )
    || !["desktop-pending", "desktop-confirmed"].includes(activation.state)
    || !activation.createdAt
    || Number.isNaN(Date.parse(activation.createdAt))
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "historyActivation is inconsistent.",
    );
  }
  const activated = manifest.workingCopies.find(
    (workingCopy) => workingCopy.workingCopyId === activation.activatedWorkingCopyId,
  );
  if (
    !activated
    || activated.versionId !== activation.versionId
    || activated.basedOnVersionId !== activation.versionId
    || runtime.activeWorkingCopyId !== activation.activatedWorkingCopyId
    || (
      activation.previousWorkingCopyId !== null
      && !manifest.workingCopies.some(
        (workingCopy) => workingCopy.workingCopyId === activation.previousWorkingCopyId,
      )
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "historyActivation no longer matches the active Working Copy.",
    );
  }
  return activation;
}

function assertLastAiTask(runtime, project, manifest) {
  const task = runtime.lastAiTask;
  if (task === undefined || task === null) return null;
  if (
    !hasExactKeys(task, [
      "attemptId",
      "candidateId",
      "completedAt",
      "documentId",
      "expectedSourceSha256",
      "inputManifestSha256",
      "projectId",
      "requestId",
      "sourceWorkingCopyId",
      "status",
    ])
    || task.projectId !== project.projectId
    || task.documentId !== project.documentId
    || !SAFE_REQUEST_ID.test(String(task.requestId || ""))
    || !SAFE_REQUEST_ID.test(String(task.attemptId || ""))
    || !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(String(task.candidateId || ""))
    || !WORKING_COPY_ID.test(String(task.sourceWorkingCopyId || ""))
    || !SHA256.test(String(task.expectedSourceSha256 || ""))
    || !SHA256.test(String(task.inputManifestSha256 || ""))
    || !["no-change", "error"].includes(task.status)
    || !validStateTimestamp(task.completedAt)
    || !manifest.workingCopies.some(
      (workingCopy) => workingCopy.workingCopyId === task.sourceWorkingCopyId,
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "lastAiTask is inconsistent.",
    );
  }
  return task;
}

function lastAiTaskAnchorFor(record) {
  return {
    requestId: record.requestId,
    attemptId: record.attemptId,
    candidateId: record.candidateId,
    projectId: record.projectId,
    documentId: record.documentId,
    sourceWorkingCopyId: record.sourceWorkingCopyId,
    expectedSourceSha256: record.expectedSourceSha256,
    inputManifestSha256: record.inputManifestSha256,
    status: record.status,
    completedAt: record.completedAt,
  };
}

// historyActivation and lastAiTask were added after the first published v4
// Runtime files. Treat either absence as its explicit null state while
// preserving every other Runtime validation. Writes converge old valid files
// without a schema-version bump or a standalone migration pass.
function normalizeRuntimeDisplayAnchors(runtime) {
  if (!isObject(runtime)) return runtime;
  if (
    Object.hasOwn(runtime, "historyActivation")
    && Object.hasOwn(runtime, "lastAiTask")
  ) return runtime;
  return {
    ...runtime,
    ...(!Object.hasOwn(runtime, "historyActivation") ? { historyActivation: null } : {}),
    ...(!Object.hasOwn(runtime, "lastAiTask") ? { lastAiTask: null } : {}),
  };
}

async function writeRuntimeState(projectRootPath, runtimePath, runtime) {
  const normalized = normalizeRuntimeDisplayAnchors(runtime);
  await atomicWriteProjectJson(
    projectRootPath,
    runtimePath,
    normalized,
    "runtime-state.json",
  );
  return normalized;
}

function assertRuntime(runtime, project, manifest) {
  if (!isObject(runtime) || runtime.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
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
    && !manifest.workingCopies.some(
      (workingCopy) => workingCopy.workingCopyId === runtime.activeWorkingCopyId,
    )
  ) {
    throw new ProjectFileRepositoryError("INVALID_RUNTIME", "activeWorkingCopyId is unknown.");
  }
  if (
    (runtime.activeRequest !== null && runtime.activeWorkingCopyId === null)
    || (runtime.activeRequest === null && runtime.activeCandidateId !== null)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "active Request runtime anchors are inconsistent.",
    );
  }
  if (runtime.activeRequest !== null) {
    const active = runtime.activeRequest;
    if (
      !isObject(active)
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
  const lastAiTask = assertLastAiTask(runtime, project, manifest);
  if (runtime.activeRequest !== null && lastAiTask !== null) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "An active Request cannot retain a terminal AI task anchor.",
    );
  }
  assertHistoryActivation(runtime, project, manifest);
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

function validStateTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function assertWorkingCopyState(state, loaded, workingCopy) {
  const expectedDraftRelativePath = draftRelativePathFor(workingCopy);
  const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
  const basedOnVersion = loaded.manifest.versions.find(
    (version) => version.versionId === workingCopy.basedOnVersionId,
  );
  if (
    !isObject(state)
    || state.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || state.projectId !== loaded.project.projectId
    || state.documentId !== loaded.project.documentId
    || state.workingCopyId !== workingCopy.workingCopyId
    || state.basedOnVersionId !== workingCopy.basedOnVersionId
    || !basedOnVersion
    || !SHA256.test(String(state.baseSha256 || ""))
    || state.baseSha256 !== basedOnVersion.contentSha256
    || !SHA256.test(String(state.currentSha256 || ""))
    || typeof state.differsFromBase !== "boolean"
    || state.differsFromBase !== (state.currentSha256 !== state.baseSha256)
    || state.draftId !== `draft_${workingCopy.workingCopyId}`
    || state.draftRelativePath !== expectedDraftRelativePath
    || (state.draftSha256 !== null && !SHA256.test(String(state.draftSha256 || "")))
    || !validRevision(state.draftRevision)
    || !WORKING_COPY_SAVE_STATES.has(state.saveState)
    || !validRevision(state.lastPersistedRevision)
    || !validStateTimestamp(state.lastSavedAt)
    || !validStateTimestamp(state.lastOpenedAt)
  ) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_STATE_INVALID",
      "The Working Copy state does not match its immutable project authority.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  return state;
}

function assertWorkingCopyDraft(draft, draftSha256, state, loaded, workingCopy) {
  const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    !isObject(draft)
    || draft.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || draft.projectId !== loaded.project.projectId
    || draft.documentId !== loaded.project.documentId
    || draft.workingCopyId !== workingCopy.workingCopyId
    || draft.basedOnVersionId !== workingCopy.basedOnVersionId
    || !validRevision(draft.draftRevision)
    || draft.draftRevision !== state.draftRevision
    || !Array.isArray(draft.comments)
    || !Array.isArray(draft.changeEvents)
    || !Array.isArray(draft.deletedCommentIds)
    || !Array.isArray(draft.appliedOperationIds)
    || state.draftSha256 === null
    || state.draftSha256 !== draftSha256
  ) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_DRAFT_INVALID",
      "The Working Copy Draft does not match its durable state.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  return draft;
}

function draftPathForState(paths, workingCopy, state) {
  const relative = state?.draftRelativePath;
  if (relative !== draftRelativePathFor(workingCopy)) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_STATE_INVALID",
      "The Working Copy state points to an unexpected Draft location.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
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

function cancellationAuthorityPath(paths, requestId, attemptId) {
  const request = String(requestId || "");
  const attempt = String(attemptId || "");
  if (!SAFE_REQUEST_ID.test(request) || !SAFE_REQUEST_ID.test(attempt)) {
    throw new ProjectFileRepositoryError(
      "INVALID_REQUEST_ID",
      "The cancellation authority identity is invalid.",
    );
  }
  return path.join(paths.recoveryRoot, "cancellations", `${request}.${attempt}.json`);
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
  if (
    !isObject(assessment)
    || assessment.schemaVersion !== "1.0.0"
    || !["ready", "attention"].includes(assessment.status)
    || !Array.isArray(assessment.issueCodes)
    || assessment.issueCodes.some((value) => typeof value !== "string" || !value)
    || !isObject(assessment.health)
    || typeof assessment.health.completeDocument !== "boolean"
    || typeof assessment.health.bodyHasContent !== "boolean"
    || !isObject(assessment.continuity)
    || !["related", "uncertain"].includes(assessment.continuity.status)
    || !assessment.assessedAt
    || Number.isNaN(Date.parse(assessment.assessedAt))
  ) {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_VALIDATION_INVALID",
      "Candidate validation evidence is invalid.",
    );
  }
  return assessment;
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

function registeredProjectCatalogAvailability(cause) {
  if (!(cause instanceof ProjectFileRepositoryError)) return "invalid";
  return new Set([
    "REGISTERED_PROJECT_UNAVAILABLE",
    "PROJECT_ROOT_NOT_FOUND",
    "PROJECT_CONTROL_NOT_FOUND",
    "WORKING_COPY_UNAVAILABLE",
    "SOURCE_NOT_FOUND",
    "UNREGISTERED_PROJECT_ROOT",
    "PATH_ESCAPES_PROJECT",
    "UNSAFE_DIRECTORY",
  ]).has(cause.code)
    ? "unavailable"
    : "invalid";
}

// This is a persistence repository, not a runtime Store. Sessions keep the
// mutable UI facts; the repository only resolves and atomically records the
// on-disk facts specified by VERSION_AND_PROJECT_FILES_PRD.md.
export class ProjectFileRepository {
  #projectsRoot;

  #registryPath;

  #clock;

  #failpoint;

  #registryWriteLockTimeoutMs;

  #registryWriteLockGraceMs;

  #registryWriteLockDepth = 0;

  #tail = Promise.resolve();

  constructor({
    projectsRoot = defaultProjectsRoot(),
    registryPath = path.join(projectsRoot, ".pageroot-registry.json"),
    clock = Date.now,
    failpoint = null,
    registryWriteLockTimeoutMs = CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS,
    registryWriteLockGraceMs = CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS,
  } = {}) {
    this.#projectsRoot = normalizedPath(projectsRoot);
    this.#registryPath = normalizedPath(registryPath);
    this.#clock = typeof clock === "function" ? clock : Date.now;
    this.#failpoint = typeof failpoint === "function" ? failpoint : null;
    this.#registryWriteLockTimeoutMs = Number.isSafeInteger(registryWriteLockTimeoutMs)
      && registryWriteLockTimeoutMs >= 1
      ? registryWriteLockTimeoutMs
      : CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS;
    this.#registryWriteLockGraceMs = Number.isSafeInteger(registryWriteLockGraceMs)
      && registryWriteLockGraceMs >= 0
      ? registryWriteLockGraceMs
      : CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS;
  }

  get projectsRoot() {
    return this.#projectsRoot;
  }

  async initialize() {
    return this.#serial(async () => {
      await ensureDirectory(this.#projectsRoot);
      await this.#assertProjectsRoot();
      await this.#readRegistry();
      await this.#withRegistryWriteLock(async () => {
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
    });
  }

  async listRegisteredProjects() {
    return this.#serial(() => this.#listRegisteredProjects());
  }

  async resolveRegisteredProjectOpenTarget({ projectId } = {}) {
    return this.#serial(() => this.#resolveRegisteredProjectOpenTarget({ projectId }));
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

  async classifyOpenPath({ sourcePath } = {}) {
    return this.#serial(() => this.#classifyOpenPath({ sourcePath }));
  }

  async reconcileWorkingCopyLocator({
    operationId,
    previousSourcePath,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    expectedSourceSha256,
    reason,
  } = {}) {
    return this.#serial(() => this.#reconcileWorkingCopyLocator({
      operationId,
      previousSourcePath,
      projectId,
      documentId,
      workingCopyId,
      versionId,
      expectedSourceSha256,
      reason,
    }));
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
    return this.#serial(() => this.#createCandidate({
      target,
      requestId,
      attemptId,
      candidateId,
      html,
      expectedSourceSha256,
      inputManifestSha256: null,
    }));
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

  async forceUnlockWorkingCopy({ sourcePath } = {}) {
    return this.#serial(() => this.#forceUnlockWorkingCopy({ sourcePath }));
  }

  async activateVersionWorkingCopy({
    target,
    versionId: requestedVersionId,
    operationId,
    expectedActiveWorkingCopyId,
  } = {}) {
    return this.#serial(() => this.#activateVersionWorkingCopy({
      target,
      requestedVersionId,
      operationId,
      expectedActiveWorkingCopyId,
    }));
  }

  async confirmVersionWorkingCopyActivation({
    target,
    operationId,
    previousWorkingCopyId,
    activatedWorkingCopyId,
    versionId,
  } = {}) {
    return this.#serial(() => this.#confirmVersionWorkingCopyActivation({
      target,
      operationId,
      previousWorkingCopyId,
      activatedWorkingCopyId,
      versionId,
    }));
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

  async resolveVersionWorkingCopy({ target, versionId: requestedVersionId } = {}) {
    return this.#serial(() => this.#resolveVersionWorkingCopy({
      target,
      requestedVersionId,
    }));
  }

  async materializeAiTaskProjection({
    target,
    requestId,
    attemptId = "attempt_001",
    candidateId = null,
  } = {}) {
    return this.#serial(() => this.#materializeAiTaskProjection({
      target,
      requestId,
      attemptId,
      candidateId,
    }));
  }

  async materializeCurrentAiTaskProjection({ target } = {}) {
    return this.#serial(() => this.#materializeCurrentAiTaskProjection({ target }));
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

  async updateProjectNotes({ target, content } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      if (typeof content !== "string") {
        throw new ProjectFileRepositoryError(
          "INVALID_PROJECT_FILE",
          "PROJECT.md must be Markdown text.",
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
      const previous = await readFile(filePath);
      const next = Buffer.from(content, "utf8");
      const updated = !previous.equals(next);
      if (updated) {
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
    const run = () => serialPathCache.run({
      realPaths: new Map(),
      verifiedRoots: new Map(),
    }, operation);
    const current = this.#tail.then(run, run);
    this.#tail = current.catch(() => {});
    return current;
  }

  async #withRegistryWriteLock(operation) {
    if (this.#registryWriteLockDepth > 0) {
      this.#registryWriteLockDepth += 1;
      try {
        return await operation();
      } finally {
        this.#registryWriteLockDepth -= 1;
      }
    }
    const release = await acquireCurrentRegistryWriteLock({
      projectsRoot: this.#projectsRoot,
      timeoutMs: this.#registryWriteLockTimeoutMs,
      graceMs: this.#registryWriteLockGraceMs,
      now: this.#clock,
      onBeforeRetire: (details) => this.#hit(
        "registry-write-lock-before-retire",
        details,
      ),
    });
    this.#registryWriteLockDepth = 1;
    try {
      return await operation();
    } finally {
      this.#registryWriteLockDepth = 0;
      await release();
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
    const record = await readJsonFileWithSha256(this.#registryPath, "project registry", {
      projectRootPath: this.#projectsRoot,
    });
    if (!record) return emptyRegistry(this.#clock);
    // A current Registry is strictly read-only at this boundary. In particular,
    // validation must not refresh its timestamp or normalize its bytes merely
    // because it was opened.
    return assertRegistry(record.value);
  }

  async #writeRuntime(loaded) {
    loaded.runtime = await writeRuntimeState(
      loaded.paths.projectRootPath,
      loaded.paths.runtimePath,
      loaded.runtime,
    );
  }

  async #workspace({ sourcePath, adoptExternalConflict = false }) {
    // A save can park the visible source in its private recovery directory
    // between two no-replace publishes. Recover the registered project before
    // resolving the requested HTML so a crash in that narrow interval does
    // not make the transaction unreachable merely because its visible name is
    // temporarily absent.
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
    if (workingCopy) {
      assertWorkingCopyState(state, loaded, workingCopy);
    }
    let draft = null;
    if (workingCopy && state) {
      const draftRecord = await readJsonFileWithSha256(
        draftPathForState(loaded.paths, workingCopy, state),
        "Working Copy draft",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (draftRecord) {
        draft = assertWorkingCopyDraft(
          draftRecord.value,
          draftRecord.sha256,
          state,
          loaded,
          workingCopy,
        );
      } else if (state.draftSha256 !== null) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_DRAFT_INVALID",
          "The Working Copy Draft is missing while its durable state references it.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
    }
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
    // A terminal no-change/error Request is not active runtime authority, but
    // its sealed runtime anchor is enough to reconstruct the immutable
    // display outcome after a relaunch. Do not scan Request directories: the
    // anchor and its verified Request record remain the only admission path.
    const terminalAiTask = !activeRequest && loaded.runtime.lastAiTask
      ? await this.#terminalAiTaskForLoaded(loaded)
      : null;
    const source = await readHtmlFile(target.exactSourcePath, "managed HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    let workingCopyRecovered = false;
    if (workingCopy && state && target.targetKind === "working-copy") {
      let reconciliation;
      try {
        reconciliation = await this.#reconcileExternalWorkingCopyState({
          loaded,
          workingCopy,
          state,
          source,
        });
      } catch (cause) {
        if (!adoptExternalConflict || cause?.code !== "WORKING_COPY_CONFLICT") {
          throw cause;
        }
        reconciliation = await this.#adoptExternalWorkingCopyState({
          loaded,
          workingCopy,
          state,
          source,
        });
      }
      state = reconciliation.state;
      workingCopyRecovered = reconciliation.recovered;
      if (workingCopyRecovered) {
        draft = await readJsonFile(
          draftPathForState(loaded.paths, workingCopy, state),
          "Working Copy draft",
          { projectRootPath: loaded.paths.projectRootPath },
        );
      }
    }
    // The active Working Copy can be reconciled from a clean external edit
    // immediately above. Build this public list only after that mutation so
    // the first hydration never returns a stale differsFromBase projection.
    const workingCopies = [];
    for (const entry of loaded.manifest.workingCopies) {
      const workingCopyState = entry.workingCopyId === workingCopy?.workingCopyId
        ? state
        : await readJsonFile(
          workingCopyStatePath(loaded.paths, entry),
          "Working Copy state",
          { projectRootPath: loaded.paths.projectRootPath },
        );
      assertWorkingCopyState(workingCopyState, loaded, entry);
      workingCopies.push({
        workingCopyId: entry.workingCopyId,
        versionId: entry.versionId,
        basedOnVersionId: entry.basedOnVersionId,
        differsFromBase: workingCopyState.differsFromBase === true,
        saveState: workingCopyState.saveState,
      });
    }
    return {
      target,
      project: structuredClone(loaded.project),
      manifest: structuredClone(loaded.manifest),
      runtime: structuredClone(loaded.runtime),
      workingCopy: workingCopy ? structuredClone(workingCopy) : null,
      workingCopyState: state ? structuredClone(state) : null,
      workingCopies: structuredClone(workingCopies),
      draft: draft ? structuredClone(draft) : null,
      activeRequest: loaded.runtime.activeRequest && activeRequest
        ? structuredClone(activeRequest)
        : null,
      activeCandidate: loaded.runtime.activeRequest && activeCandidate
        ? structuredClone(activeCandidate.candidate)
        : null,
      terminalRequest: terminalAiTask
        ? this.#publicRequest(terminalAiTask.record, loaded.paths.projectRootPath)
        : null,
      workingCopyRecovered,
      content: source.html,
      sourceSha256: source.sha256,
      lastModifiedAt: source.lastModifiedAt,
    };
  }

  async #reconcileExternalWorkingCopyState({ loaded, workingCopy, state, source }) {
    assertWorkingCopyState(state, loaded, workingCopy);
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

  async #adoptExternalWorkingCopyState({ loaded, workingCopy, state, source }) {
    assertWorkingCopyState(state, loaded, workingCopy);
    if (
      String(state.currentSha256 || "") === source.sha256
      && state.saveState === "saved"
    ) {
      return { state, recovered: false };
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
      // lastPersistedRevision stays at the last successful PageRoot write.
      // Adopting disk bytes does not invent a new persisted edit. The
      // renderer then uses Math.max against its session revision so the
      // current window looks saved; a cold start hydrates from this disk
      // revision together with the adopted HTML.
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      workingCopyStatePath(loaded.paths, workingCopy),
      nextState,
      "Working Copy state",
    );
    if (loaded.runtime.activeRequest) {
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await this.#writeRuntime(loaded);
    }
    return { state: nextState, recovered: true };
  }

  async #forceUnlockWorkingCopy({ sourcePath }) {
    const workspace = await this.#workspace({
      sourcePath,
      adoptExternalConflict: true,
    });
    if (!workspace) {
      throw new ProjectFileRepositoryError(
        "PROJECT_NOT_FOUND",
        "No PageRoot project is registered for this HTML.",
      );
    }
    return {
      status: "force-unlocked",
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      sourcePath: workspace.target.exactSourcePath,
      sourceSha256: workspace.sourceSha256,
      sha256: workspace.sourceSha256,
      content: workspace.content,
      lastModifiedAt: workspace.lastModifiedAt,
      workingCopyState: workspace.workingCopyState,
    };
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
      if (existing.expectedSourceSha256 !== expected) {
        throw new ProjectFileRepositoryError(
          "REQUEST_COLLISION",
          "This Request id belongs to another frozen source state.",
        );
      }
      await this.#restoreRequestRuntime(loaded, existing);
      await this.#publishAiTaskProjectionIfPossible({
        target,
        requestId: id,
        attemptId: attempt,
        candidateId: existing.candidateId,
      });
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
    assertWorkingCopyState(workingState, loaded, loaded.workingCopy);
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
    loaded.runtime.lastAiTask = null;
    await this.#writeRuntime(loaded);
    await this.#hit("request-runtime-written", { requestId: id, requestRoot });
    await this.#publishAiTaskProjectionIfPossible({
      target,
      requestId: id,
      attemptId: attempt,
      candidateId: idForCandidate,
    });
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
  }

  async #frozenPromptForAiTaskProjection(loaded, record) {
    const inputManifestPath = resolveRelative(
      loaded.paths.controlRoot,
      record.inputManifestRelativePath,
      "request input manifest path",
    );
    const inputManifestRecord = await readJsonFileWithSha256(
      inputManifestPath,
      "request input manifest",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const inputManifest = inputManifestRecord?.value || null;
    if (
      !inputManifestRecord
      || inputManifestRecord.sha256 !== record.inputManifestSha256
      || !isObject(inputManifest)
      || inputManifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || inputManifest.projectId !== loaded.project.projectId
      || inputManifest.documentId !== loaded.project.documentId
      || inputManifest.requestId !== record.requestId
      || inputManifest.attemptId !== record.attemptId
      || inputManifest.frozen !== true
      || !Array.isArray(inputManifest.files)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request bundle cannot safely provide an AI task Prompt.",
      );
    }
    const promptEntry = inputManifest.files.find((entry) => (
      isObject(entry)
      && entry.path === "PROMPT.md"
      && entry.role === "prompt"
      && entry.mediaType === "text/markdown"
    ));
    if (
      !promptEntry
      || !SHA256.test(String(promptEntry.sha256 || ""))
      || !Number.isSafeInteger(Number(promptEntry.byteLength))
      || Number(promptEntry.byteLength) < 0
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request bundle has no valid Prompt record.",
      );
    }
    const promptPath = resolveRelative(
      loaded.paths.controlRoot,
      record.promptRelativePath,
      "request prompt path",
    );
    const prompt = await readRegularFileWithSha256(
      promptPath,
      "Request prompt",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (
      !prompt
      || prompt.sha256 !== promptEntry.sha256
      || prompt.buffer.byteLength !== Number(promptEntry.byteLength)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request Prompt no longer matches its manifest.",
      );
    }
    return {
      path: promptPath,
      buffer: prompt.buffer,
      sha256: prompt.sha256,
    };
  }

  // AI任务/ is a derived Finder display. Once a Request or Candidate has
  // crossed its durable authority boundary, a publication failure must not
  // retract that hidden fact. Explicit Finder requests remain strict through
  // #materializeAiTaskProjection and can be retried independently.
  async #publishAiTaskProjectionIfPossible(args) {
    try {
      return await this.#materializeAiTaskProjection(args);
    } catch {
      return null;
    }
  }

  async #terminalAiTaskForLoaded(loaded) {
    const terminal = loaded.runtime.lastAiTask;
    if (!terminal) return null;
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === terminal.sourceWorkingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The terminal AI task no longer names a managed Working Copy.",
      );
    }
    const requestPath = path.join(
      requestRootPath(loaded.paths, terminal.requestId),
      "request.json",
    );
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, { ...loaded, workingCopy }, {
      requestId: terminal.requestId,
      attemptId: terminal.attemptId,
    });
    if (
      terminal.projectId !== record.projectId
      || terminal.documentId !== record.documentId
      || terminal.candidateId !== record.candidateId
      || terminal.sourceWorkingCopyId !== record.sourceWorkingCopyId
      || terminal.expectedSourceSha256 !== record.expectedSourceSha256
      || terminal.inputManifestSha256 !== record.inputManifestSha256
      || terminal.status !== record.status
      || terminal.completedAt !== record.completedAt
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The terminal AI task no longer matches its sealed runtime anchor.",
      );
    }
    return { record, workingCopy };
  }

  async #materializeCurrentAiTaskProjection({ target }) {
    const loaded = await this.#resolveMutationTarget(target);
    const active = loaded.runtime.activeRequest;
    if (!active && !loaded.runtime.lastAiTask) {
      throw new ProjectFileRepositoryError(
        "AI_TASK_NOT_ACTIVE",
        "The current project has no active or terminal AI task to reveal.",
      );
    }
    let record;
    let materializationTarget = target;
    if (active) {
      const requestPath = path.join(
        requestRootPath(loaded.paths, active.requestId),
        "request.json",
      );
      record = await readJsonFile(requestPath, "request.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      this.#assertRequestRecord(record, loaded, {
        requestId: active.requestId,
        attemptId: active.attemptId,
      });
      if (
        active.inputManifestSha256 !== record.inputManifestSha256
        || (
          active.status === "pending-review"
          && active.candidateId !== record.candidateId
        )
      ) {
        throw new ProjectFileRepositoryError(
          "REQUEST_RUNTIME_ANCHOR_MISMATCH",
          "The active Request no longer matches its runtime authority.",
        );
      }
    } else {
      const terminal = await this.#terminalAiTaskForLoaded(loaded);
      record = terminal.record;
      materializationTarget = {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        projectRootPath: loaded.paths.projectRootPath,
        workingCopyId: terminal.workingCopy.workingCopyId,
      };
    }
    return this.#materializeAiTaskProjection({
      target: materializationTarget,
      requestId: record.requestId,
      attemptId: record.attemptId,
      candidateId: record.candidateId,
    });
  }

  async #materializeAiTaskProjection({
    target,
    requestId,
    attemptId,
    candidateId,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const request = String(requestId || "");
    const attempt = String(attemptId || "attempt_001");
    if (!SAFE_REQUEST_ID.test(request) || !SAFE_REQUEST_ID.test(attempt)) {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_ID",
        "The AI task projection Request identity is invalid.",
      );
    }
    const requestPath = path.join(requestRootPath(loaded.paths, request), "request.json");
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId: request, attemptId: attempt });
    const expectedCandidateId = assertCandidateId(record.candidateId);
    if (candidateId !== null && candidateId !== undefined) {
      const requestedCandidateId = assertCandidateId(candidateId);
      if (requestedCandidateId !== expectedCandidateId) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_IDENTITY_MISMATCH",
          "The requested AI task Candidate does not belong to this Request.",
        );
      }
    }
    const frozenPrompt = await this.#frozenPromptForAiTaskProjection(loaded, record);
    let candidateState = null;
    if (["candidate-ready", "promoted", "rejected"].includes(record.status)) {
      candidateState = await this.#readCandidateForLoaded(loaded, expectedCandidateId);
      const candidate = candidateState.candidate;
      if (
        candidate.candidateId !== expectedCandidateId
        || candidate.projectId !== loaded.project.projectId
        || candidate.documentId !== loaded.project.documentId
        || candidate.requestId !== record.requestId
        || candidate.attemptId !== record.attemptId
        || candidate.proposedVersionId !== record.proposedVersionId
        || Number(candidate.proposedVersionOrdinal) !== Number(record.proposedVersionOrdinal)
        || candidate.basedOnVersionId !== record.basedOnVersionId
        || candidate.previousVersionId !== record.previousVersionId
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "The Candidate does not match the frozen AI task identity.",
        );
      }
    }
    const candidateFileName = aiTaskCandidateFileName(
      loaded.workingCopy.preferredFileStem,
      record.proposedVersionOrdinal,
      loaded.workingCopy.preferredExtension,
    );
    try {
      const projection = await materializeAiTaskProjection({
        projectRootPath: loaded.paths.projectRootPath,
        recoveryRootPath: path.join(
          loaded.paths.recoveryRoot,
          "ai-task-projections",
        ),
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        requestId: record.requestId,
        attemptId: record.attemptId,
        candidateId: expectedCandidateId,
        proposedVersionId: record.proposedVersionId,
        proposedVersionOrdinal: record.proposedVersionOrdinal,
        createdAt: record.createdAt,
        promptBuffer: frozenPrompt.buffer,
        promptSha256: frozenPrompt.sha256,
        candidateBuffer: candidateState?.output.buffer || null,
        candidateSha256: candidateState?.output.sha256 || null,
        candidateFileName,
        onStage: (name, details) => this.#hit(name, {
          requestId: record.requestId,
          attemptId: record.attemptId,
          candidateId: expectedCandidateId,
          ...details,
        }),
      });
      return {
        ...projection,
        status: record.status,
        hasCandidate: candidateState !== null,
      };
    } catch (cause) {
      if (cause instanceof AiTaskProjectionError) {
        throw new ProjectFileRepositoryError(cause.code, cause.message, cause.details);
      }
      throw cause;
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

  async #recordRequestValidationError({ loaded, record, cause, previewHtml = "" }) {
    const mapped = mapCandidateValidationError(cause) || {
      errorCode: String(cause?.code || "CANDIDATE_UNUSABLE"),
      message: String(cause?.message || "The Candidate HTML is unusable."),
      errorDetail: "输出未通过安全校验",
      recoveryHint: "请检查 AI Agent 的输出后重新提交。",
    };
    const requestPath = path.join(
      requestRootPath(loaded.paths, record.requestId),
      "request.json",
    );
    record.status = "error";
    record.completedAt = nowIso(this.#clock);
    record.error = {
      code: String(cause?.code || mapped.errorCode),
      message: mapped.message,
      errorCode: mapped.errorCode,
      errorDetail: mapped.errorDetail,
      recoveryHint: mapped.recoveryHint,
      issueCodes: Array.isArray(cause?.details?.issueCodes)
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
    loaded.runtime.lastAiTask = lastAiTaskAnchorFor(record);
    await this.#writeRuntime(loaded);
    const publicRequest = this.#publicRequest(record, loaded.paths.projectRootPath);
    const preview = previewSnippet(previewHtml);
    if (preview && isObject(publicRequest.error)) {
      publicRequest.error = {
        ...publicRequest.error,
        errorPreview: preview,
      };
    }
    return {
      status: "error",
      request: publicRequest,
    };
  }

  async #restoreRequestRuntime(loaded, record) {
    this.#assertRequestRecord(record, loaded, {
      requestId: record.requestId,
      attemptId: record.attemptId,
    });
    const existingActiveRequest = loaded.runtime.activeRequest;
    if (
      existingActiveRequest
      && (
        existingActiveRequest.requestId !== record.requestId
        || existingActiveRequest.attemptId !== record.attemptId
      )
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The frozen Request identity no longer matches runtime authority.",
      );
    }
    if (
      existingActiveRequest
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
        if (
          ["no-change", "error"].includes(status)
          && validStateTimestamp(record.completedAt)
        ) {
          loaded.runtime.lastAiTask = lastAiTaskAnchorFor(record);
        }
        await this.#writeRuntime(loaded);
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
      loaded.runtime.lastAiTask = null;
      await this.#writeRuntime(loaded);
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
    }).catch(async (cause) => {
      if (String(cause?.code || "") !== "INCOMPLETE_HTML") throw cause;
      let previewHtml = "";
      try {
        previewHtml = await readFile(outputPath, "utf8");
      } catch {
        previewHtml = "";
      }
      return { incomplete: true, cause, previewHtml };
    });
    if (output?.incomplete) {
      return this.#recordRequestValidationError({
        loaded,
        record,
        cause: output.cause,
        previewHtml: output.previewHtml,
      });
    }
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
    if (record.status === "candidate-ready") {
      const rejected = await this.#rejectCandidate({ target, candidateId: record.candidateId });
      return {
        ...rejected,
        requestId,
        attemptId,
        status: "cancelled",
      };
    }
    if (["rejected", "no-change", "promoted", "error"].includes(record.status)) {
      return {
        requestId,
        attemptId,
        status: "already-inactive",
        terminalStatus: record.status,
      };
    }
    if (!["processing", "cancelled"].includes(record.status)) {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_STATUS",
        "The Request has an unsupported lifecycle state.",
      );
    }
    const authorityPath = cancellationAuthorityPath(loaded.paths, requestId, attemptId);
    const authority = await readJsonFile(authorityPath, "request cancellation authority", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const validAuthority = authority
      && authority.schemaVersion === PROJECT_FILE_SCHEMA_VERSION
      && authority.kind === "request-cancellation"
      && authority.projectId === loaded.project.projectId
      && authority.documentId === loaded.project.documentId
      && authority.requestId === requestId
      && authority.attemptId === attemptId
      && authority.sourceWorkingCopyId === loaded.workingCopy.workingCopyId
      && authority.expectedSourceSha256 === record.expectedSourceSha256
      && authority.inputManifestSha256 === record.inputManifestSha256
      && validStateTimestamp(authority.cancelledAt);
    const active = loaded.runtime.activeRequest;
    const activeMatches = active
      && active.requestId === requestId
      && active.attemptId === attemptId
      && active.inputManifestSha256 === record.inputManifestSha256;
    if (record.status === "cancelled" && !activeMatches) {
      if (!validAuthority) {
        throw new ProjectFileRepositoryError(
          "CANCELLATION_AUTHORITY_MISMATCH",
          "The Request cancellation is not sealed outside the Agent-writable Request tree.",
        );
      }
      return { requestId, attemptId, status: "already-inactive", terminalStatus: "cancelled" };
    }
    if (!activeMatches) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The active Request runtime does not authorize this cancellation.",
      );
    }
    if (!validAuthority) {
      await ensureProjectDirectory(
        loaded.paths.projectRootPath,
        path.dirname(authorityPath),
        "request cancellation authority directory",
      );
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        authorityPath,
        {
          schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
          kind: "request-cancellation",
          projectId: loaded.project.projectId,
          documentId: loaded.project.documentId,
          requestId,
          attemptId,
          sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
          expectedSourceSha256: record.expectedSourceSha256,
          inputManifestSha256: record.inputManifestSha256,
          cancelledAt: nowIso(this.#clock),
        },
        "request cancellation authority",
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
    if (activeMatches) {
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await this.#writeRuntime(loaded);
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
    assertWorkingCopyState(state, loaded, loaded.workingCopy);
    const draftPath = draftPathForState(loaded.paths, loaded.workingCopy, state);
    const persisted = await readJsonFile(draftPath, "Working Copy draft", {
      projectRootPath: loaded.paths.projectRootPath,
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

  async #resolveVersionWorkingCopy({ target, requestedVersionId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const id = assertId(requestedVersionId, VERSION_ID, "versionId");
    const version = loaded.manifest.versions.find((entry) => entry.versionId === id);
    if (!version) {
      throw new ProjectFileRepositoryError(
        "VERSION_NOT_FOUND",
        "The requested Version was not found.",
      );
    }
    const matches = loaded.manifest.workingCopies.filter((workingCopy) => (
      workingCopy.versionId === id
      && workingCopy.basedOnVersionId === id
    ));
    if (matches.length !== 1) {
      throw new ProjectFileRepositoryError(
        "VERSION_WORKING_COPY_UNAVAILABLE",
        "The Version has no unambiguous visible Working Copy.",
        { versionId: id, workingCopyIds: matches.map((entry) => entry.workingCopyId) },
      );
    }
    const workingCopy = matches[0];
    // A historical Working Copy has the same controlled rename semantics as
    // the active one. Resolve it by stable file identity before reading the
    // visible path, so Finder renames do not make a valid Version reveal fail.
    const resolvedSource = await this.#resolveWorkingCopySource(
      loaded,
      workingCopy,
      "Version Working Copy",
    );
    const state = await readJsonFile(
      workingCopyStatePath(loaded.paths, workingCopy),
      "Version Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    assertWorkingCopyState(state, loaded, workingCopy);
    const reconciled = await this.#reconcileExternalWorkingCopyState({
      loaded,
      workingCopy,
      state,
      source: resolvedSource.source,
    });
    return {
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      projectRootPath: loaded.paths.projectRootPath,
      versionId: version.versionId,
      workingCopyId: workingCopy.workingCopyId,
      workingCopyPath: resolvedSource.exactSourcePath,
      sourceSha256: resolvedSource.source.sha256,
      workingCopyState: structuredClone(reconciled.state),
    };
  }

  async #activateVersionWorkingCopy({
    target,
    requestedVersionId,
    operationId: requestedOperationId,
    expectedActiveWorkingCopyId: requestedExpectedActiveWorkingCopyId,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requested = assertId(requestedVersionId, VERSION_ID, "versionId");
    const operationId = String(requestedOperationId || "");
    if (!SAFE_OPERATION_ID.test(operationId)) {
      throw new ProjectFileRepositoryError(
        "INVALID_HISTORY_ACTIVATION_OPERATION",
        "The history Working Copy activation operationId is invalid.",
      );
    }
    const expectedActiveWorkingCopyId = assertId(
      requestedExpectedActiveWorkingCopyId,
      WORKING_COPY_ID,
      "expectedActiveWorkingCopyId",
    );
    const version = loaded.manifest.versions.find(
      (entry) => entry.versionId === requested,
    );
    if (!version) {
      throw new ProjectFileRepositoryError("VERSION_NOT_FOUND", "The requested Version was not found.");
    }
    const matches = loaded.manifest.workingCopies.filter((workingCopy) => (
      workingCopy.versionId === requested
      && workingCopy.basedOnVersionId === requested
    ));
    if (matches.length !== 1) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_VERSION_MISMATCH",
        "The requested Version does not have one unambiguous editable Working Copy.",
        { versionId: requested, workingCopyIds: matches.map((entry) => entry.workingCopyId) },
      );
    }
    const workingCopy = matches[0];
    const previousWorkingCopyId = loaded.runtime.activeWorkingCopyId;
    const state = await readJsonFile(
      workingCopyStatePath(loaded.paths, workingCopy),
      "Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    assertWorkingCopyState(state, loaded, workingCopy);
    const snapshot = await readHtmlFile(
      versionSnapshotPath(loaded.paths, version),
      "Version snapshot",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (snapshot.sha256 !== version.contentSha256) {
      throw new ProjectFileRepositoryError(
        "VERSION_SNAPSHOT_HASH_MISMATCH",
        "The immutable Version snapshot changed and cannot be activated.",
      );
    }
    const exactSourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    const source = await readHtmlFile(exactSourcePath, "Version Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const reconciled = await this.#reconcileExternalWorkingCopyState({
      loaded,
      workingCopy,
      state,
      source,
    });
    const activationResult = (historyActivation, { activated, replayed }) => ({
      target: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy,
        version,
        exactSourcePath,
        sourceSha256: source.sha256,
      }),
      workingCopyState: structuredClone(reconciled.state),
      activated,
      replayed,
      previousWorkingCopyId: historyActivation.previousWorkingCopyId,
      historyActivation: structuredClone(historyActivation),
    });
    const existing = loaded.runtime.historyActivation || null;
    const matchesExisting = (activation, { requireOperationId = false } = {}) => Boolean(
      activation
      && (!requireOperationId || activation.operationId === operationId)
      && activation.projectId === loaded.project.projectId
      && activation.documentId === loaded.project.documentId
      && activation.versionId === requested
      && activation.previousWorkingCopyId === expectedActiveWorkingCopyId
      && activation.activatedWorkingCopyId === workingCopy.workingCopyId
    );
    if (matchesExisting(existing, { requireOperationId: true })) {
      return activationResult(existing, { activated: false, replayed: true });
    }
    // A repeated click after a lost Bridge, Desktop, or confirmation response
    // resumes the one durable operation. The receipt's original operationId is
    // returned so Desktop and the confirmation replay against the same key.
    if (
      ["desktop-pending", "desktop-confirmed"].includes(existing?.state)
      && matchesExisting(existing)
    ) {
      return activationResult(existing, { activated: false, replayed: true });
    }
    if (loaded.runtime.activeRequest) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_REQUEST_EXISTS",
        "A Working Copy cannot change while an AI Request remains active.",
      );
    }
    if (loaded.runtime.activeWorkingCopyId !== expectedActiveWorkingCopyId) {
      throw new ProjectFileRepositoryError(
        "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT",
        "The active Working Copy changed before this history activation could commit.",
        {
          expectedActiveWorkingCopyId,
          activeWorkingCopyId: loaded.runtime.activeWorkingCopyId,
          versionId: requested,
        },
      );
    }
    const historyActivation = {
      operationId,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      previousWorkingCopyId,
      activatedWorkingCopyId: workingCopy.workingCopyId,
      versionId: requested,
      state: "desktop-pending",
      createdAt: nowIso(this.#clock),
    };
    loaded.runtime.activeWorkingCopyId = workingCopy.workingCopyId;
    loaded.runtime.historyActivation = historyActivation;
    await this.#writeRuntime(loaded);
    return activationResult(historyActivation, { activated: true, replayed: false });
  }

  async #confirmVersionWorkingCopyActivation({
    target,
    operationId: requestedOperationId,
    previousWorkingCopyId: requestedPreviousWorkingCopyId,
    activatedWorkingCopyId: requestedActivatedWorkingCopyId,
    versionId: requestedVersionId,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const operationId = String(requestedOperationId || "");
    if (!SAFE_OPERATION_ID.test(operationId)) {
      throw new ProjectFileRepositoryError(
        "INVALID_HISTORY_ACTIVATION_OPERATION",
        "The history Working Copy activation operationId is invalid.",
      );
    }
    const previousWorkingCopyId = requestedPreviousWorkingCopyId === null
      ? null
      : assertId(requestedPreviousWorkingCopyId, WORKING_COPY_ID, "previousWorkingCopyId");
    const activatedWorkingCopyId = assertId(
      requestedActivatedWorkingCopyId,
      WORKING_COPY_ID,
      "activatedWorkingCopyId",
    );
    const versionId = assertId(requestedVersionId, VERSION_ID, "versionId");
    const historyActivation = loaded.runtime.historyActivation || null;
    if (
      !historyActivation
      || historyActivation.operationId !== operationId
      || historyActivation.projectId !== loaded.project.projectId
      || historyActivation.documentId !== loaded.project.documentId
      || historyActivation.previousWorkingCopyId !== previousWorkingCopyId
      || historyActivation.activatedWorkingCopyId !== activatedWorkingCopyId
      || historyActivation.versionId !== versionId
      || loaded.runtime.activeWorkingCopyId !== activatedWorkingCopyId
    ) {
      throw new ProjectFileRepositoryError(
        "HISTORY_ACTIVATION_RECEIPT_MISMATCH",
        "The history activation confirmation does not match the durable activation receipt.",
      );
    }
    if (historyActivation.state === "desktop-confirmed") {
      return { historyActivation: structuredClone(historyActivation), confirmed: false };
    }
    historyActivation.state = "desktop-confirmed";
    loaded.runtime.historyActivation = historyActivation;
    await this.#writeRuntime(loaded);
    return {
      historyActivation: structuredClone(historyActivation),
      confirmed: true,
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
    const outputHtml = String(html || "");
    try {
      requireCompleteHtml(outputHtml, "Candidate HTML");
    } catch (cause) {
      return this.#recordRequestValidationError({
        loaded,
        record,
        cause,
        previewHtml: outputHtml,
      });
    }
    const outputSha256 = sha256(Buffer.from(outputHtml, "utf8"));
    if (record.status === "candidate-ready" || record.status === "promoted") {
      const candidate = await this.#readCandidateForLoaded(loaded, record.candidateId);
      if (candidate.output.sha256 !== outputSha256) {
        throw new ProjectFileRepositoryError(
          "REQUEST_OUTPUT_CHANGED",
          "The finalized Candidate output changed after review began.",
        );
      }
      await this.#publishAiTaskProjectionIfPossible({
        target,
        requestId: record.requestId,
        attemptId: record.attemptId,
        candidateId: record.candidateId,
      });
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
      loaded.runtime.lastAiTask = lastAiTaskAnchorFor(record);
      await this.#writeRuntime(loaded);
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
      if (!mapCandidateValidationError(cause) && cause?.code !== "CANDIDATE_UNUSABLE") {
        throw cause;
      }
      return this.#recordRequestValidationError({
        loaded,
        record,
        cause,
        previewHtml: outputHtml,
      });
    }
    record.status = "candidate-ready";
    record.completedAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      requestPath,
      record,
      "request.json",
    );
    await this.#publishAiTaskProjectionIfPossible({
      target,
      requestId: record.requestId,
      attemptId: record.attemptId,
      candidateId: record.candidateId,
    });
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

  async #preparePendingImport({
    projectId,
    documentId,
    projectRootPath,
    createdAt,
    importSourceKey,
    importSourceSha256,
  }) {
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
    const sourceClaims = this.#externalSourceClaims(registry, importSourceKey);
    if (sourceClaims.committed.length > 0 || sourceClaims.pending.length > 0) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "This external source is already claimed by a registered or pending project.",
      );
    }
    registry.pendingImports[projectId] = {
      projectId,
      documentId,
      registeredProjectRootPath: target.projectRootPath,
      createdAt,
      importSourceKey: assertSha256(importSourceKey, "importSourceKey"),
      importSourceSha256: assertSha256(importSourceSha256, "importSourceSha256"),
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
        ...(pending.importSourceKey && pending.importSourceSha256
          ? {
            importSourceKey: pending.importSourceKey,
            importSourceSha256: pending.importSourceSha256,
          }
          : {}),
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

  async #readExternalSourceDescriptor(sourcePath, { beforeRead = null } = {}) {
    const requestedPath = normalizedPath(sourcePath);
    htmlExtension(requestedPath);
    const information = await regularInformation(requestedPath, "external HTML");
    if (!information) {
      throw new ProjectFileRepositoryError(
        "SOURCE_NOT_FOUND",
        "external HTML was not found.",
      );
    }
    const canonicalSourcePath = normalizedPath(await cachedRealPath(requestedPath));
    htmlExtension(canonicalSourcePath);
    const source = await readHtmlFile(canonicalSourcePath, "external HTML", {
      beforeRead,
    });
    return {
      canonicalSourcePath,
      sourceKey: sha256(Buffer.from(canonicalSourcePath, "utf8")),
      sourceSha256: source.sha256,
      buffer: source.buffer,
      html: source.html,
      information: source.information,
    };
  }

  #externalSourceClaims(registry, sourceKey) {
    const committed = [];
    const pending = [];
    for (const [projectId, record] of Object.entries(registry.projects)) {
      if (record.importSourceKey === sourceKey) {
        committed.push({ projectId, record });
      }
    }
    for (const [projectId, record] of Object.entries(registry.pendingImports)) {
      if (record.importSourceKey === sourceKey) {
        pending.push({ projectId, record });
      }
    }
    return { committed, pending };
  }

  async #externalSourceProjectFacts({ projectId, record, currentSourceSha256 }) {
    const opened = await this.#resolveRegisteredProjectOpenTarget({ projectId });
    const loaded = await this.#loadRegisteredProject({ projectId });
    const workingCopy = await this.#activeRegisteredWorkingCopy(loaded);
    const state = assertWorkingCopyState(
      await readJsonFile(
        workingCopyStatePath(loaded.paths, workingCopy),
        "active Working Copy state",
        { projectRootPath: loaded.paths.projectRootPath },
      ),
      loaded,
      workingCopy,
    );
    const basedOnVersion = loaded.manifest.versions.find(
      (version) => version.versionId === workingCopy.basedOnVersionId,
    );
    const latestVersion = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const initialVersion = loaded.manifest.versions.find((version) => version.ordinal === 1);
    if (
      !basedOnVersion
      || !latestVersion
      || !initialVersion
      || initialVersion.ordinal !== 1
      || initialVersion.contentSha256 !== record.importSourceSha256
    ) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_INVALID",
        "The bound project no longer has a valid initial Version for this external source.",
        { projectId },
      );
    }
    const snapshot = await readHtmlFile(
      versionSnapshotPath(loaded.paths, initialVersion),
      "initial Version snapshot",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (snapshot.sha256 !== record.importSourceSha256) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_INVALID",
        "The bound project's initial Version snapshot does not match the recorded import.",
        { projectId },
      );
    }
    return {
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      projectName: path.basename(loaded.paths.projectRootPath),
      openTarget: opened.target,
      currentBasedOnVersionId: basedOnVersion.versionId,
      currentBasedOnOrdinal: basedOnVersion.ordinal,
      latestOfficialVersionId: latestVersion.versionId,
      latestOfficialOrdinal: latestVersion.ordinal,
      currentDiffersFromBase: state.differsFromBase === true,
      initialVersionId: initialVersion.versionId,
      initialVersionOrdinal: initialVersion.ordinal,
      sourceRelation: currentSourceSha256 === record.importSourceSha256
        ? "unchanged"
        : "changed",
    };
  }

  async #resolveExternalSourceBinding({ sourceKey, currentSourceSha256 }) {
    const registry = await this.#readRegistry();
    const claims = this.#externalSourceClaims(registry, sourceKey);
    if (claims.committed.length > 1) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "More than one registered project claims this external source.",
      );
    }
    if (
      claims.committed.length === 1
      && claims.pending.some((item) => item.projectId !== claims.committed[0].projectId)
    ) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "A pending import conflicts with the registered external source binding.",
      );
    }
    if (claims.committed.length === 1) {
      return this.#externalSourceProjectFacts({
        projectId: claims.committed[0].projectId,
        record: claims.committed[0].record,
        currentSourceSha256,
      });
    }
    if (claims.pending.length > 1) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "More than one pending import claims this external source.",
      );
    }
    return null;
  }

  async #recoverOrClearPendingExternalSource(sourceKey, currentSourceSha256) {
    const registry = await this.#readRegistry();
    const claims = this.#externalSourceClaims(registry, sourceKey);
    if (claims.pending.length !== 1 || claims.committed.length > 0) return null;
    const pending = claims.pending[0];
    try {
      await this.#publishPendingImport(pending.projectId);
    } catch (cause) {
      const pendingRoot = await directoryInformation(
        pending.record.registeredProjectRootPath,
        "pending import root",
        { projectRootPath: this.#projectsRoot },
      );
      if (!pendingRoot) {
        await this.#clearPendingImportIfMatches(
          pending.projectId,
          pending.record.registeredProjectRootPath,
        );
        return null;
      }
      throw new ProjectFileRepositoryError(
        "SOURCE_IMPORT_PENDING",
        "A previous import of this external source is still pending recovery.",
        { projectId: pending.projectId, cause: cause?.code || null },
      );
    }
    return this.#resolveExternalSourceBinding({
      sourceKey,
      currentSourceSha256,
    });
  }

  async #classifyOpenPath({ sourcePath }) {
    const requestedPath = normalizedPath(sourcePath);
    htmlExtension(requestedPath);
    const managedTarget = await this.#resolveOpenTarget({ sourcePath: requestedPath });
    if (managedTarget) {
      return {
        kind: "managed-project",
        target: managedTarget,
        sourceSha256: managedTarget.sourceSha256,
      };
    }
    const descriptor = await this.#readExternalSourceDescriptor(requestedPath);
    const binding = await this.#resolveExternalSourceBinding({
      sourceKey: descriptor.sourceKey,
      currentSourceSha256: descriptor.sourceSha256,
    });
    if (binding) {
      return {
        kind: "known-external",
        sourceSha256: descriptor.sourceSha256,
        sourceRelation: binding.sourceRelation,
        projectFacts: binding,
      };
    }
    const stem = safeProjectName(descriptor.canonicalSourcePath);
    const extension = htmlExtension(descriptor.canonicalSourcePath);
    return {
      kind: "new-external",
      sourceSha256: descriptor.sourceSha256,
      sourceFileName: path.basename(descriptor.canonicalSourcePath),
      visibleV1FileName: visibleFileName(stem, 1, extension),
    };
  }

  async #importExternal({
    sourcePath,
    expectedSourceSha256,
  }) {
    await ensureDirectory(this.#projectsRoot);
    await this.#assertProjectsRoot();
    await this.#readRegistry();
    return this.#withRegistryWriteLock(async () => {
      await this.#recoverPublishedImports();
      const requestedPath = normalizedPath(sourcePath);
      htmlExtension(requestedPath);
      const existingTarget = await this.#resolveOpenTarget({ sourcePath: requestedPath });
      if (existingTarget) return { imported: false, target: existingTarget };
      const descriptor = await this.#readExternalSourceDescriptor(requestedPath, {
        beforeRead: ({ filePath, information }) => this.#hit("html-read-after-stat", {
          filePath,
          size: information.size,
        }),
      });
      if (
        expectedSourceSha256
        && descriptor.sourceSha256 !== assertSha256(expectedSourceSha256, "expectedSourceSha256")
      ) {
        throw new ProjectFileRepositoryError(
          "SOURCE_HASH_CONFLICT",
          "The external HTML changed before import.",
          {
            expectedSourceSha256,
            actualSourceSha256: descriptor.sourceSha256,
          },
        );
      }
      const bound = await this.#resolveExternalSourceBinding({
        sourceKey: descriptor.sourceKey,
        currentSourceSha256: descriptor.sourceSha256,
      });
      if (bound) return { imported: false, target: bound.openTarget };
      const recoveredPending = await this.#recoverOrClearPendingExternalSource(
        descriptor.sourceKey,
        descriptor.sourceSha256,
      );
      if (recoveredPending) {
        return { imported: false, target: recoveredPending.openTarget };
      }
      return this.#publishNewExternalImport(descriptor);
    });
  }

  async #publishNewExternalImport(descriptor) {
    const stem = safeProjectName(descriptor.canonicalSourcePath);
    const extension = htmlExtension(descriptor.canonicalSourcePath);
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
        importSourceKey: descriptor.sourceKey,
        importSourceSha256: descriptor.sourceSha256,
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
      await atomicWriteProjectFile(stagingRoot, snapshotPath, descriptor.buffer, "initial Version snapshot");
      await this.#hit("import-snapshot-written", { stagingRoot });
      await atomicWriteProjectFile(stagingRoot, visiblePath, descriptor.buffer, "initial Working Copy");
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
        contentSha256: descriptor.sourceSha256,
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
        baseSha256: descriptor.sourceSha256,
        currentSha256: descriptor.sourceSha256,
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
        historyActivation: null,
        lastAiTask: null,
      };
      await atomicWriteProjectJson(stagingRoot, paths.projectPath, project, "project.json");
      await atomicWriteProjectJson(stagingRoot, paths.manifestPath, manifest, "manifest.json");
      await atomicWriteProjectJson(
        stagingRoot,
        workingCopyStatePath(paths, firstWorkingCopy),
        workingState,
        "initial Working Copy state",
      );
      await writeRuntimeState(stagingRoot, paths.runtimePath, runtime);
      await atomicWriteProjectJson(stagingRoot, path.join(paths.recoveryRoot, "import.json"), {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        kind: "import",
        state: "prepared",
        projectId,
        documentId,
        externalSourceSha256: descriptor.sourceSha256,
        createdAt,
      }, "import recovery record");
      await atomicWriteProjectFile(
        stagingRoot,
        path.join(stagingRoot, "PROJECT.md"),
        Buffer.from(`# ${stem}\n`, "utf8"),
        "PROJECT.md",
      );
      await this.#hit("import-metadata-written", { stagingRoot });

      const sourceBeforePublish = await this.#readExternalSourceDescriptor(
        descriptor.canonicalSourcePath,
      );
      if (sourceBeforePublish.sourceSha256 !== descriptor.sourceSha256) {
        throw new ProjectFileRepositoryError(
          "SOURCE_HASH_CONFLICT",
          "The external HTML changed during import.",
          {
            expectedSourceSha256: descriptor.sourceSha256,
            actualSourceSha256: sourceBeforePublish.sourceSha256,
          },
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
          sourceSha256: descriptor.sourceSha256,
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
      const directoryName = projectDirectoryName(stem, ordinal);
      const candidate = path.join(this.#projectsRoot, directoryName);
      // Allocation is a collision probe, not a request to trust or inspect an
      // existing entry. Files, directories and symlinks all reserve the name
      // and are skipped without turning a harmless placeholder into an unsafe
      // directory error.
      const occupied = await lstat(candidate).catch((cause) => {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      });
      if (!occupied) {
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
      normalizeRuntimeDisplayAnchors(await readJsonFile(paths.runtimePath, "runtime-state.json", {
        projectRootPath: root,
      })),
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

  #registeredProjectCatalogFallback(projectId, record, availability) {
    return {
      projectId,
      documentId: null,
      projectName: path.basename(record.registeredProjectRootPath),
      registeredProjectRootPath: record.registeredProjectRootPath,
      activeWorkingCopyId: null,
      activeSourcePath: null,
      currentBasedOnVersionId: null,
      latestOfficialVersionId: null,
      hasPendingCandidate: false,
      availability,
    };
  }

  async #activeRegisteredWorkingCopy(loaded) {
    const workingCopyIdValue = loaded.runtime.activeWorkingCopyId;
    if (!workingCopyIdValue) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_WORKING_COPY_REQUIRED",
        "The registered project has no active Working Copy to open.",
      );
    }
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === workingCopyIdValue,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_WORKING_COPY_UNKNOWN",
        "The registered project active Working Copy is unknown.",
      );
    }
    return workingCopy;
  }

  async #listRegisteredProjects() {
    const registry = await this.#readRegistry();
    const rows = [];
    for (const [projectId, record] of Object.entries(registry.projects)) {
      try {
        // Catalog availability must use the same controlled Working Copy
        // recovery as an actual open. Reading the old manifest path first
        // would mark a safely Finder-renamed HTML unavailable before its
        // stable file identity can rebind the manifest.
        const opened = await this.#resolveRegisteredProjectOpenTarget({ projectId });
        const loaded = await this.#loadRegisteredProject({ projectId });
        const workingCopy = loaded.manifest.workingCopies.find(
          (entry) => entry.workingCopyId === opened.target.workingCopyId,
        );
        if (!workingCopy) {
          throw new ProjectFileRepositoryError(
            "ACTIVE_WORKING_COPY_UNKNOWN",
            "The registered project active Working Copy is unknown.",
          );
        }
        const state = await readJsonFile(
          workingCopyStatePath(loaded.paths, workingCopy),
          "active Working Copy state",
          { projectRootPath: loaded.paths.projectRootPath },
        );
        assertWorkingCopyState(state, loaded, workingCopy);
        rows.push({
          projectId: loaded.project.projectId,
          documentId: loaded.project.documentId,
          projectName: path.basename(loaded.paths.projectRootPath),
          registeredProjectRootPath: loaded.paths.projectRootPath,
          activeWorkingCopyId: workingCopy.workingCopyId,
          activeSourcePath: opened.target.exactSourcePath,
          currentBasedOnVersionId: workingCopy.basedOnVersionId,
          latestOfficialVersionId: loaded.manifest.latestOfficialVersionId,
          hasPendingCandidate: loaded.runtime.activeCandidateId !== null,
          availability: "ready",
        });
      } catch (cause) {
        rows.push(this.#registeredProjectCatalogFallback(
          projectId,
          record,
          registeredProjectCatalogAvailability(cause),
        ));
      }
    }
    return rows.sort((left, right) => (
      left.projectName.localeCompare(right.projectName, "zh-CN")
      || left.projectId.localeCompare(right.projectId)
    ));
  }

  async #resolveRegisteredProjectOpenTarget({ projectId }) {
    const id = assertId(projectId, PROJECT_ID, "projectId");
    const loaded = await this.#loadRegisteredProject({ projectId: id });
    const workingCopy = await this.#activeRegisteredWorkingCopy(loaded);
    // This bootstrap identity intentionally contains no source bytes. The
    // shared mutation resolver reads them only after it has recovered a
    // supported same-root Finder rename by the Working Copy file identity.
    const resolved = await this.#resolveMutationTarget({
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      projectRootPath: loaded.paths.projectRootPath,
      workingCopyId: workingCopy.workingCopyId,
    });
    // The returned source bytes and digest form the Repository side of the
    // exact Project/Document/OpenTarget/HTML/Hash tuple; Desktop repeats it
    // before publishing a new Session.
    const version = resolved.manifest.versions.find(
      (entry) => entry.versionId === resolved.workingCopy.versionId,
    );
    if (!version) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_VERSION_UNKNOWN",
        "The active Working Copy references an unknown Version.",
      );
    }
    return {
      target: publicOpenTarget({
        project: resolved.project,
        projectRootPath: resolved.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: resolved.workingCopy,
        version,
        exactSourcePath: resolved.exactSourcePath,
        sourceSha256: resolved.source.sha256,
      }),
      sourceSha256: resolved.source.sha256,
    };
  }

  async #reconcileWorkingCopyLocator({
    operationId,
    previousSourcePath,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    expectedSourceSha256,
    reason,
  }) {
    const requestedOperationId = String(operationId || "");
    if (!SAFE_OPERATION_ID.test(requestedOperationId)) {
      throw new ProjectFileRepositoryError(
        "INVALID_OPERATION_ID",
        "operationId is invalid.",
      );
    }
    const requestedReason = String(reason || "");
    if (!RECONCILE_LOCATOR_REASONS.has(requestedReason)) {
      throw new ProjectFileRepositoryError(
        "INVALID_RECONCILE_REASON",
        "The locator reconcile reason is not allowed.",
      );
    }
    const previousPath = normalizedPath(previousSourcePath);
    htmlExtension(previousPath);
    const expectedHash = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const requestedWorkingCopyId = assertId(
      workingCopyId,
      WORKING_COPY_ID,
      "workingCopyId",
    );
    const requestedVersionId = assertId(versionId, VERSION_ID, "versionId");
    const loaded = await this.#loadRegisteredProject({
      projectId,
      documentId,
    });
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === requestedWorkingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_UNAVAILABLE",
        "The Working Copy HTML is temporarily unavailable; PageRoot did not write outside its registered path.",
        { workingCopyId: requestedWorkingCopyId },
      );
    }
    if (workingCopy.versionId !== requestedVersionId) {
      throw new ProjectFileRepositoryError(
        "MANAGED_SOURCE_IDENTITY_MISMATCH",
        "The supplied Working Copy identity does not match the registered source.",
        { workingCopyId: requestedWorkingCopyId },
      );
    }

    const mappedPath = workingCopySourcePath(loaded.paths, workingCopy);
    let exactSourcePath = mappedPath;
    let sourceInformation = await regularInformation(mappedPath, "Working Copy", {
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
          "The Working Copy HTML is temporarily unavailable; PageRoot did not write outside its registered path.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
      exactSourcePath = recoveredPath;
      sourceInformation = await regularInformation(exactSourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!sourceInformation) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_UNAVAILABLE",
          "The Working Copy HTML disappeared while PageRoot was recovering its registered path.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
      if (
        !sameFileIdentity(
          workingCopy.fileIdentity,
          copyFileIdentity(sourceInformation),
        )
      ) {
        throw new ProjectFileRepositoryError(
          "MANAGED_SOURCE_IDENTITY_MISMATCH",
          "The recovered HTML does not match the registered Working Copy identity.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
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
    const pathChanged = !samePath(exactSourcePath, previousPath);
    const contentChanged = source.sha256 !== expectedHash;
    const status = contentChanged
      ? "content-changed"
      : pathChanged
        ? "relocated"
        : "unchanged";
    const version = loaded.manifest.versions.find(
      (entry) => entry.versionId === workingCopy.versionId,
    );
    return {
      operationId: requestedOperationId,
      status,
      reason: requestedReason,
      previousSourcePath: previousPath,
      sourcePath: exactSourcePath,
      sourceSha256: source.sha256,
      openTarget: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy,
        version,
        exactSourcePath,
        sourceSha256: source.sha256,
      }),
    };
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

  async #resolveWorkingCopySource(loaded, workingCopy, label = "Working Copy") {
    let exactSourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    let sourceInformation = await regularInformation(exactSourcePath, label, {
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
          "The Working Copy HTML is temporarily unavailable; PageRoot did not write outside its registered path.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
      exactSourcePath = recoveredPath;
      sourceInformation = await regularInformation(exactSourcePath, label, {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!sourceInformation) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_UNAVAILABLE",
          "The Working Copy HTML disappeared while PageRoot was recovering its registered path.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
    }
    await this.#rebindWorkingCopyPath(
      loaded,
      workingCopy,
      exactSourcePath,
      sourceInformation,
    );
    const source = await readHtmlFile(exactSourcePath, label, {
      projectRootPath: loaded.paths.projectRootPath,
    });
    return { exactSourcePath, source };
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
    // A Finder rename is a controlled recovery only when the registered
    // manifest mapping is actually absent.  A second hard link, copied file,
    // same name or same bytes never becomes managed while the recorded member
    // remains present.  The Registry, v4 IDs, missing registered mapping and
    // one surviving file-identity clue are all required before rebinding.
    const matching = [];
    for (const workingCopy of manifest.workingCopies) {
      const mappedPath = workingCopySourcePath(paths, workingCopy);
      const mappedInformation = await regularInformation(mappedPath, "Working Copy", {
        projectRootPath: paths.projectRootPath,
      });
      if (mappedInformation) continue;
      if (sameFileIdentity(workingCopy.fileIdentity, copyFileIdentity(source.information))) {
        matching.push(workingCopy);
      }
    }
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
    const workingCopy = matching[0] || null;
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
    const source = await this.#resolveWorkingCopySource(loaded, workingCopy);
    return { ...loaded, workingCopy, ...source };
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
    if (matches.length > 1) {
      throw new ProjectFileRepositoryError(
        "MANAGED_PATH_AMBIGUOUS",
        "More than one Working Copy has the same filesystem identity.",
        { candidateCount: matches.length },
      );
    }
    return matches[0] || null;
  }

  async #saveWorkingCopy({ target, html, expectedSourceSha256, editRevision }) {
    const loaded = await this.#resolveMutationTarget(target);
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const nextHtml = String(html || "");
    requireCompleteHtml(nextHtml, "Working Copy HTML");
    const nextBuffer = Buffer.from(nextHtml, "utf8");
    const nextSha256 = sha256(nextBuffer);
    const revision = Number.isSafeInteger(Number(editRevision)) && Number(editRevision) >= 0
      ? Number(editRevision)
      : 0;
    const statePath = workingCopyStatePath(loaded.paths, loaded.workingCopy);
    const currentState = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!currentState) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The Working Copy state is missing; PageRoot did not modify its HTML.",
      );
    }
    assertWorkingCopyState(currentState, loaded, loaded.workingCopy);
    const recoveryId = `save_${loaded.workingCopy.workingCopyId}_${revision || "current"}_${randomUUID().replaceAll("-", "")}`;
    const recoveryPaths = saveRecoveryPaths(
      loaded.paths,
      loaded.workingCopy.workingCopyId,
      revision,
      recoveryId,
    );
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      recoveryPaths.operationRoot,
      "save recovery directory",
    );
    const transactionPath = path.join(
      loaded.paths.transactionsRoot,
      `${recoveryId}.json`,
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
      recoveryId,
      preparedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "save transaction",
    );
    await atomicWriteProjectFile(
      loaded.paths.projectRootPath,
      recoveryPaths.nextPath,
      nextBuffer,
      "save replacement bytes",
    );
    await this.#hit("save-prepared", { transactionPath });

    let cas = await compareAndSwapWorkingCopyFile({
      sourcePath: loaded.exactSourcePath,
      nextBuffer,
      expectedSha256: expected,
      nextSha256,
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!cas.swapped && cas.actualSha256 === nextSha256) {
      const disk = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      cas = {
        swapped: true,
        actualSha256: disk.sha256,
        written: disk,
      };
    }
    if (!cas.swapped) {
      await this.#finalizeSaveTransaction(
        loaded.paths.projectRootPath,
        transactionPath,
        transaction,
        {
          state: "committed",
          recovery: nextSha256 === expected
            ? "adopted-external"
            : "source-changed-before-cas",
        },
      );
      await rm(recoveryPaths.operationRoot, { recursive: true, force: true }).catch(() => {});
      if (nextSha256 === expected && cas.actualSha256) {
        const disk = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        const adopted = await this.#reconcileExternalWorkingCopyState({
          loaded,
          workingCopy: loaded.workingCopy,
          state: currentState,
          source: disk,
        });
        return this.#savedWorkingCopyResult({
          loaded,
          sourcePath: loaded.exactSourcePath,
          sourceSha256: disk.sha256,
          lastPersistedRevision: Number(adopted.state.lastPersistedRevision || 0),
        });
      }
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_CONFLICT",
        "The Working Copy changed on disk while PageRoot still retains unsaved edits.",
        {
          expectedSourceSha256: expected,
          actualSourceSha256: cas.actualSha256,
          targetSourceSha256: nextSha256,
          saveState: currentState.saveState || null,
        },
      );
    }

    await this.#hit("save-source-written", { transactionPath });
    loaded.workingCopy.fileIdentity = copyFileIdentity(cas.written.information);
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
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.manifestPath,
      loaded.manifest,
      "manifest.json",
    );
    await this.#writeRuntime(loaded);
    await this.#finalizeSaveTransaction(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      { state: "committed" },
    );
    await rm(recoveryPaths.operationRoot, { recursive: true, force: true }).catch(() => {});
    await syncDirectory(loaded.paths.recoveryRoot).catch(() => {});
    return this.#savedWorkingCopyResult({
      loaded,
      sourcePath: loaded.exactSourcePath,
      sourceSha256: nextSha256,
      lastPersistedRevision: nextState.lastPersistedRevision,
    });
  }

  async #finalizeSaveTransaction(projectRootPath, transactionPath, transaction, extra) {
    const current = await readJsonFile(transactionPath, "save transaction", {
      projectRootPath,
    });
    await atomicWriteProjectJson(
      projectRootPath,
      transactionPath,
      {
        ...(current || transaction),
        ...extra,
        committedAt: nowIso(this.#clock),
      },
      "save transaction",
    );
  }

  #savedWorkingCopyResult({ loaded, sourcePath, sourceSha256, lastPersistedRevision }) {
    return {
      target: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: loaded.workingCopy,
        version: loaded.manifest.versions.find(
          (version) => version.versionId === loaded.workingCopy.versionId,
        ),
        exactSourcePath: sourcePath,
        sourceSha256,
      }),
      lastPersistedRevision,
      currentSha256: sourceSha256,
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
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const manifestAnchor = inputManifestSha256 === null
      ? null
      : assertSha256(inputManifestSha256, "inputManifestSha256");
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
    const latest = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const planned = candidateIdentity && isObject(candidateIdentity)
      ? {
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
        }
      : {
          proposedVersionId: versionId(latest.ordinal + 1),
          proposedVersionOrdinal: latest.ordinal + 1,
          basedOnVersionId: loaded.workingCopy.basedOnVersionId,
          previousVersionId: latest.versionId,
        };
    if (
      !Number.isSafeInteger(planned.proposedVersionOrdinal)
      || planned.proposedVersionOrdinal < 2
      || planned.proposedVersionId !== versionId(planned.proposedVersionOrdinal)
    ) {
      throw new ProjectFileRepositoryError("INVALID_CANDIDATE", "Candidate Version identity is invalid.");
    }
    const id = candidateId ? candidateId : randomId("candidate");
    assertCandidateId(id);
    const requestRoot = requestRootPath(loaded.paths, request);
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
        || active?.attemptId !== String(attemptId || "attempt_001")
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
        attemptId: String(attemptId || "attempt_001"),
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
      attemptId: String(attemptId || "attempt_001"),
      status: "pending-review",
      inputManifestSha256: manifestAnchor,
      candidateOutputSha256: outputSha256,
      candidateRecordSha256,
    };
    loaded.runtime.activeCandidateId = id;
    loaded.runtime.lastAiTask = null;
    await this.#writeRuntime(loaded);
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
    assertCandidateAssessment(candidate.assessment);
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
    await this.#writeRuntime(loaded);
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

  async #reallocatePreparedPromotion(loaded, transactionRoot, transaction) {
    if (transaction.state !== "working-copy-prepared") return false;
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

  #assertPromotionTransactionAuthority(loaded, candidateState, transaction) {
    const candidate = candidateState.candidate;
    const candidateOrdinal = candidate.proposedVersionOrdinal;
    const sourceWorkingCopy = loaded.manifest.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === candidate.sourceWorkingCopyId,
    );
    if (!sourceWorkingCopy) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_WORKING_COPY_MISSING",
        "The Candidate source Working Copy is no longer available.",
        { candidateId: candidate.candidateId, sourceWorkingCopyId: candidate.sourceWorkingCopyId },
      );
    }
    const preferredFileStem = assertPreferredFileStem(sourceWorkingCopy.preferredFileStem);
    const preferredExtension = htmlExtension(
      "x" + String(sourceWorkingCopy.preferredExtension || ""),
    );
    const transactionId = "promote_" + candidate.candidateId;
    const hasValidOrdinal = Number.isSafeInteger(candidateOrdinal) && candidateOrdinal >= 2;
    const hasValidAllocation = (
      Number.isSafeInteger(transaction.pathAllocationOrdinal)
      && transaction.pathAllocationOrdinal >= 0
    );
    const expectedVersionId = hasValidOrdinal ? versionId(candidateOrdinal) : null;
    const expectedFinalWorkingCopyRelativePath = (
      hasValidOrdinal && hasValidAllocation
        ? visibleFileName(
          preferredFileStem,
          candidateOrdinal,
          preferredExtension,
          transaction.pathAllocationOrdinal,
        )
        : null
    );
    const expectedPreparedWorkingCopyRelativePath = "transactions/" + transactionId
      + "/prepared-working-copy" + preferredExtension;
    const mismatch = () => {
      throw new ProjectFileRepositoryError(
        "PROMOTION_TRANSACTION_MISMATCH",
        "The Promotion transaction does not match the runtime-sealed Candidate authority.",
      );
    };

    if (
      !hasValidOrdinal
      || candidate.proposedVersionId !== expectedVersionId
      || transaction.transactionId !== transactionId
      || transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
      || transaction.candidateId !== candidate.candidateId
      || transaction.requestId !== candidate.requestId
      || transaction.versionId !== expectedVersionId
      || transaction.versionOrdinal !== candidateOrdinal
      || transaction.candidateOutputSha256 !== candidate.outputSha256
      || transaction.basedOnVersionId !== candidate.basedOnVersionId
      || transaction.previousVersionId !== candidate.previousVersionId
      || transaction.preferredFileStem !== preferredFileStem
      || transaction.preferredExtension !== preferredExtension
      || !hasValidAllocation
      || transaction.finalWorkingCopyRelativePath !== expectedFinalWorkingCopyRelativePath
      || transaction.preparedWorkingCopyRelativePath !== expectedPreparedWorkingCopyRelativePath
    ) {
      mismatch();
    }

    const hasPreparedWorkingCopy = [
      "working-copy-prepared",
      "working-copy-created",
      "manifest-committed",
      "completed",
    ].includes(transaction.state);
    let preparedWorkingCopyFileIdentity = null;
    if (hasPreparedWorkingCopy) {
      try {
        preparedWorkingCopyFileIdentity = assertFileIdentity(
          transaction.preparedWorkingCopyFileIdentity,
          "Promotion prepared Working Copy fileIdentity",
        );
      } catch {
        mismatch();
      }
    } else if (transaction.preparedWorkingCopyFileIdentity !== null) {
      mismatch();
    }

    const hasCreatedWorkingCopy = [
      "working-copy-created",
      "manifest-committed",
      "completed",
    ].includes(transaction.state);
    if (!hasCreatedWorkingCopy) {
      if (transaction.workingCopy !== null) mismatch();
      return;
    }

    const expectedWorkingCopyId = workingCopyId(candidateOrdinal);
    const workingCopy = transaction.workingCopy;
    let workingCopyFileIdentity;
    try {
      workingCopyFileIdentity = assertFileIdentity(
        workingCopy?.fileIdentity,
        "Promotion Working Copy fileIdentity",
      );
    } catch {
      mismatch();
    }
    if (
      !isObject(workingCopy)
      || workingCopy.workingCopyId !== expectedWorkingCopyId
      || workingCopy.versionId !== expectedVersionId
      || workingCopy.basedOnVersionId !== expectedVersionId
      || workingCopy.sourceRelativePath !== expectedFinalWorkingCopyRelativePath
      || workingCopy.preferredFileStem !== preferredFileStem
      || workingCopy.preferredExtension !== preferredExtension
      || workingCopy.stateRelativePath !== "working-copies/" + expectedWorkingCopyId + ".json"
      || !sameFileIdentity(workingCopyFileIdentity, preparedWorkingCopyFileIdentity)
    ) {
      mismatch();
    }
  }

  async #readCommittedPromotion(loaded, transaction) {
    const committedVersion = loaded.manifest.versions.find(
      (version) => version.versionId === transaction.versionId,
    );
    const committedWorkingCopy = loaded.manifest.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === transaction.workingCopy?.workingCopyId,
    );
    if (
      !committedVersion
      || !committedWorkingCopy
      || loaded.manifest.latestOfficialVersionId !== transaction.versionId
      || committedVersion.ordinal !== transaction.versionOrdinal
      || committedVersion.basedOnVersionId !== transaction.basedOnVersionId
      || committedVersion.previousVersionId !== transaction.previousVersionId
      || committedVersion.contentSha256 !== transaction.candidateOutputSha256
      || committedVersion.snapshotRelativePath !== "versions/" + transaction.versionId + "/index.html"
      || committedVersion.sourceRequestId !== transaction.requestId
      || committedVersion.sourceCandidateId !== transaction.candidateId
      || committedWorkingCopy.workingCopyId !== transaction.workingCopy.workingCopyId
      || committedWorkingCopy.versionId !== transaction.workingCopy.versionId
      || committedWorkingCopy.basedOnVersionId !== transaction.workingCopy.basedOnVersionId
      || committedWorkingCopy.sourceRelativePath !== transaction.workingCopy.sourceRelativePath
      || committedWorkingCopy.preferredFileStem !== transaction.workingCopy.preferredFileStem
      || committedWorkingCopy.preferredExtension !== transaction.workingCopy.preferredExtension
      || committedWorkingCopy.stateRelativePath !== transaction.workingCopy.stateRelativePath
      || !sameFileIdentity(committedWorkingCopy.fileIdentity, transaction.workingCopy.fileIdentity)
    ) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_COMMIT_MISMATCH",
        "The committed Promotion facts do not match the sealed transaction authority.",
      );
    }
    const snapshot = await readHtmlFile(
      versionSnapshotPath(loaded.paths, committedVersion),
      "Version snapshot",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (snapshot.sha256 !== transaction.candidateOutputSha256) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_COMMIT_MISMATCH",
        "The committed Promotion snapshot no longer matches the sealed Candidate bytes.",
      );
    }
    return { committedVersion, committedWorkingCopy };
  }

  async #continuePromotion(loaded, candidateState, transactionRoot, transaction) {
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
    // Promotion and crash recovery both start from the runtime-sealed
    // Candidate.  A raw candidate.json/candidate.html pair is never enough to
    // resume an adoption after review has begun.
    candidateState = await this.#readCandidateForLoaded(
      loaded,
      transaction.candidateId,
    );
    if (
      candidateState.candidate.candidateId !== transaction.candidateId
      || candidateState.candidate.outputSha256 !== transaction.candidateOutputSha256
    ) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_AUTHORITY_MISMATCH",
        "The Promotion Candidate no longer matches its sealed transaction authority.",
      );
    }
    this.#assertPromotionTransactionAuthority(loaded, candidateState, transaction);
    topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath);
    assertPreferredFileStem(transaction.preferredFileStem);
    if (!HTML_EXTENSIONS.has(String(transaction.preferredExtension || "").toLowerCase())) {
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
      const prepared = await readHtmlFile(preparedPath, "prepared Version Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (prepared.sha256 !== transaction.candidateOutputSha256) {
        throw new ProjectFileRepositoryError(
          "PROMOTION_PREPARED_FILE_CHANGED",
          "The Promotion preparation file no longer matches the sealed Candidate bytes.",
        );
      }
      let visibleInformation;
      while (true) {
        const visiblePath = path.join(
          loaded.paths.projectRootPath,
          topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath),
        );
        visibleInformation = await lstat(visiblePath).catch((cause) => {
          if (cause?.code === "ENOENT") return null;
          throw cause;
        });
        const visibleIsPrepared = Boolean(
          visibleInformation
          && !visibleInformation.isSymbolicLink()
          && visibleInformation.isFile()
          && sameFileIdentity(
            transaction.preparedWorkingCopyFileIdentity,
            copyFileIdentity(visibleInformation),
          ),
        );
        if (visibleIsPrepared) {
          const visible = await readHtmlFile(visiblePath, "Version Working Copy", {
            projectRootPath: loaded.paths.projectRootPath,
          });
          if (visible.sha256 !== transaction.candidateOutputSha256) {
            throw new ProjectFileRepositoryError(
              "PROMOTION_PATH_REPLACED",
              "The allocated Version Working Copy changed after publication.",
              { sourceRelativePath: transaction.finalWorkingCopyRelativePath },
            );
          }
          break;
        }
        if (visibleInformation) {
          await this.#reallocatePreparedPromotion(loaded, transactionRoot, transaction);
          continue;
        }
        // The publication syscall, rather than this observation, owns the
        // no-replace guarantee.  Keeping this test hook between them proves
        // that a concurrent user file cannot be overwritten after a clean
        // lstat result.
        await this.#hit("promotion-visible-publication-before-link", {
          transactionRoot,
          sourceRelativePath: transaction.finalWorkingCopyRelativePath,
          visiblePath,
        });
        try {
          await link(preparedPath, visiblePath);
          await syncDirectory(loaded.paths.projectRootPath);
        } catch (cause) {
          if (cause?.code !== "EEXIST") throw cause;
          await this.#reallocatePreparedPromotion(loaded, transactionRoot, transaction);
          continue;
        }
        visibleInformation = await lstat(visiblePath).catch((cause) => {
          if (cause?.code === "ENOENT") return null;
          throw cause;
        });
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
        const visible = await readHtmlFile(visiblePath, "Version Working Copy", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (visible.sha256 !== transaction.candidateOutputSha256) {
          throw new ProjectFileRepositoryError(
            "PROMOTION_PATH_REPLACED",
            "The allocated Version Working Copy changed after publication.",
            { sourceRelativePath: transaction.finalWorkingCopyRelativePath },
          );
        }
        break;
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
      const visible = await readHtmlFile(visiblePath, "Version Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (visible.sha256 !== transaction.candidateOutputSha256) {
        throw new ProjectFileRepositoryError(
          "PROMOTION_PATH_REPLACED",
          "The allocated Version Working Copy bytes changed before manifest publication.",
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
    const { committedVersion, committedWorkingCopy } = await this.#readCommittedPromotion(
      loaded,
      transaction,
    );
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
      loaded.runtime.historyActivation = null;
      await this.#writeRuntime(loaded);
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
    const usesRecoveryDirectory = isObject(transaction)
      && Object.hasOwn(transaction, "recoveryId");
    const allowedStates = usesRecoveryDirectory
      ? new Set([
        "prepared",
        "committed",
        // Legacy eight-state park journals remain readable so a crash in an
        // older PageRoot can still recover complete old or complete new bytes.
        "next-staged",
        "parking",
        "source-parked",
        "source-publishing",
        "source-published",
        "conflict",
      ])
      : new Set(["prepared", "committed"]);
    if (
      !isObject(transaction)
      || transaction.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || transaction.kind !== "save"
      || !allowedStates.has(transaction.state)
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
    assertWorkingCopyState(currentState, loaded, workingCopy);
    const revision = Number.isSafeInteger(Number(transaction.editRevision))
      && Number(transaction.editRevision) >= 0
      ? Number(transaction.editRevision)
      : Number(currentState.lastPersistedRevision || 0);
    const commitSavedSource = async (source) => {
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
    };
    const commitRolledBack = async (recovery) => {
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
        ...transaction,
        state: "committed",
        committedAt: nowIso(this.#clock),
        recovery,
      }, "save transaction");
      return {
        kind: "save",
        workingCopyId: workingCopy.workingCopyId,
        state: "rolled-back",
      };
    };

    // Existing v4 save records did not have a private recovery directory.
    // Retain their previous recovery behavior so a newer PageRoot can safely
    // reopen a project that was saved by the earlier PR head.
    if (!usesRecoveryDirectory) {
      const source = await readHtmlFile(sourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (source.sha256 === target) return commitSavedSource(source);
      if (source.sha256 === expected && transaction.state === "prepared") {
        return commitRolledBack("source-unchanged");
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

    const recoveryPaths = saveRecoveryPaths(
      loaded.paths,
      workingCopy.workingCopyId,
      transaction.editRevision,
      transaction.recoveryId,
    );
    const source = await readRegularFileWithSha256(sourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const previous = await readRegularFileWithSha256(
      recoveryPaths.previousPath,
      "saved Working Copy",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const next = await readRegularFileWithSha256(
      recoveryPaths.nextPath,
      "save replacement bytes",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (transaction.state === "conflict") {
      throw new ProjectFileRepositoryError(
        "SAVE_RECOVERY_CONFLICT",
        "The Working Copy changed during an interrupted save and was not overwritten.",
        {
          workingCopyId: workingCopy.workingCopyId,
          expectedSourceSha256: expected,
          targetSourceSha256: target,
          actualSourceSha256: source?.sha256 || null,
          parkedSourceSha256: previous?.sha256 || null,
        },
      );
    }
    if (source?.sha256 === target) {
      // `committed` means PageRoot published its new source and metadata, not
      // that the parked old inode has become irrelevant. An external editor
      // can retain an FD to previous.html across a crash at this point, so
      // preserve and surface its late write before treating the save as done.
      if (previous && previous.sha256 !== expected) {
        await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
          ...transaction,
          state: "conflict",
          recovery: "parked-source-changed-after-publish",
          parkedSourceSha256: previous.sha256,
          retainedAt: nowIso(this.#clock),
        }, "save transaction");
        throw new ProjectFileRepositoryError(
          "SAVE_RECOVERY_CONFLICT",
          "The Working Copy changed through an already-open external file after PageRoot saved it; the external bytes were retained for recovery.",
          {
            workingCopyId: workingCopy.workingCopyId,
            expectedSourceSha256: expected,
            targetSourceSha256: target,
            parkedSourceSha256: previous.sha256,
          },
        );
      }
      const saved = await readHtmlFile(sourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const committed = await commitSavedSource(saved);
      // This is the same best-effort cleanup boundary as a non-interrupted
      // save. It happens only after the parked bytes have been rechecked.
      await rm(recoveryPaths.operationRoot, { recursive: true, force: true }).catch(() => {});
      await syncDirectory(loaded.paths.recoveryRoot).catch(() => {});
      return committed;
    }
    if (!source && previous) {
      if (previous.sha256 === expected && next?.sha256 === target) {
        try {
          await linkFileNoReplace(
            recoveryPaths.nextPath,
            sourcePath,
            target,
            "Working Copy",
            { projectRootPath: loaded.paths.projectRootPath },
          );
        } catch (cause) {
          throw new ProjectFileRepositoryError(
            "SAVE_RECOVERY_CONFLICT",
            "The Working Copy changed while an interrupted save was being recovered.",
            {
              workingCopyId: workingCopy.workingCopyId,
              expectedSourceSha256: expected,
              targetSourceSha256: target,
              cause: cause instanceof Error ? cause.message : String(cause),
            },
          );
        }
        const saved = await readHtmlFile(sourcePath, "Working Copy", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (saved.sha256 !== target) {
          throw new ProjectFileRepositoryError(
            "SAVE_RECOVERY_CONFLICT",
            "The Working Copy changed while an interrupted save was being verified.",
            {
              workingCopyId: workingCopy.workingCopyId,
              expectedSourceSha256: expected,
              targetSourceSha256: target,
              actualSourceSha256: saved.sha256,
            },
          );
        }
        return commitSavedSource(saved);
      }
      if (previous.sha256 !== expected) {
        try {
          await linkFileNoReplace(
            recoveryPaths.previousPath,
            sourcePath,
            previous.sha256,
            "Working Copy recovery",
            { projectRootPath: loaded.paths.projectRootPath },
          );
          await unlink(recoveryPaths.previousPath);
          await syncDirectory(recoveryPaths.operationRoot);
          return commitRolledBack("source-changed-before-park");
        } catch (cause) {
          throw new ProjectFileRepositoryError(
            "SAVE_RECOVERY_CONFLICT",
            "The externally changed Working Copy could not be restored safely.",
            {
              workingCopyId: workingCopy.workingCopyId,
              expectedSourceSha256: expected,
              targetSourceSha256: target,
              cause: cause instanceof Error ? cause.message : String(cause),
            },
          );
        }
      }
    }
    if (source?.sha256 === expected) {
      return commitRolledBack("source-unchanged");
    }
    if (
      source
      && !previous
      && ["prepared", "next-staged", "parking"].includes(transaction.state)
    ) {
      // Visible bytes are neither the expected old source nor the prepared
      // replacement. PageRoot never mixes those histories: keep both complete
      // sequences and fail closed.
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
    if (!source && next && next.sha256 !== target) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_INVALID",
        "The staged Working Copy bytes no longer match the save transaction.",
      );
    }
    throw new ProjectFileRepositoryError(
      "SAVE_RECOVERY_CONFLICT",
      "The Working Copy changed during an interrupted save and was not overwritten.",
      {
        workingCopyId: workingCopy.workingCopyId,
        expectedSourceSha256: expected,
        targetSourceSha256: target,
        actualSourceSha256: source?.sha256 || null,
        parkedSourceSha256: previous?.sha256 || null,
      },
    );
  }

  async #recoverRequestRuntime(loaded) {
    const runtimeAnchor = loaded.runtime.activeRequest;
    // Request / Attempt files are writable by the external Agent. They are
    // evidence to validate against PageRoot-owned runtime state, never a
    // source from which reopening may infer new active-work authority.
    if (!runtimeAnchor) return null;
    const workingCopy = loaded.manifest.workingCopies.find(
      (candidate) => candidate.workingCopyId === loaded.runtime.activeWorkingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The active Request has no registered Working Copy runtime anchor.",
        {
          requestId: runtimeAnchor.requestId,
          attemptId: runtimeAnchor.attemptId,
        },
      );
    }
    const requestPath = path.join(
      requestRootPath(loaded.paths, runtimeAnchor.requestId),
      "request.json",
    );
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!record) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISSING",
        "The active Request record is unavailable; PageRoot will not infer replacement Request authority.",
        {
          requestId: runtimeAnchor.requestId,
          attemptId: runtimeAnchor.attemptId,
        },
      );
    }
    this.#assertRequestRecord(record, { ...loaded, workingCopy }, {
      requestId: runtimeAnchor.requestId,
      attemptId: runtimeAnchor.attemptId,
    });
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
        let committedRecoveryDirectory = false;
        if (
          transaction?.state === "committed"
          && isObject(transaction)
          && Object.hasOwn(transaction, "recoveryId")
        ) {
          const recoveryPaths = saveRecoveryPaths(
            loaded.paths,
            transaction.workingCopyId,
            transaction.editRevision,
            transaction.recoveryId,
          );
          committedRecoveryDirectory = Boolean(await directoryInformation(
            recoveryPaths.operationRoot,
            "save recovery directory",
            { projectRootPath: loaded.paths.projectRootPath },
          ));
        }
        if (transaction?.state !== "committed" || committedRecoveryDirectory) {
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
      if (!transaction || transaction.kind !== "promotion" || transaction.state === "completed") continue;
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
