import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
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
  atomicWriteJson,
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

function defaultProjectsRoot() {
  return path.join(os.homedir(), "Documents", "PageRoot", "项目");
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function normalizedPath(value) {
  return path.resolve(String(value || "")).normalize("NFC");
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
  if (allowRoot && resolvedRoot === resolvedCandidate) return true;
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
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

function visibleFileName(stem, ordinal, extension) {
  return `${stem}-V${ordinal}${extension}`;
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

function hasUnsupportedRelativeResource(html) {
  const attributes = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/giu;
  for (const match of html.matchAll(attributes)) {
    const target = String(match[2] || "").trim();
    if (
      !target
      || target.startsWith("#")
      || target.startsWith("data:")
      || target.startsWith("mailto:")
      || target.startsWith("tel:")
      || /^[a-z][a-z0-9+.-]*:/iu.test(target)
      || target.startsWith("//")
    ) continue;
    return target;
  }
  return null;
}

async function regularInformation(filePath, label) {
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

async function directoryInformation(directoryPath, label) {
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

async function readHtmlFile(filePath, label) {
  const information = await regularInformation(filePath, label);
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

async function readJsonFile(filePath, label) {
  const information = await regularInformation(filePath, label);
  if (!information) return null;
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new ProjectFileRepositoryError("INVALID_JSON", `${label} is not valid JSON.`);
  }
  if (!isObject(value)) {
    throw new ProjectFileRepositoryError("INVALID_JSON", `${label} must be an object.`);
  }
  return value;
}

async function writeFileNoReplace(filePath, buffer, expectedSha256, label) {
  const expected = assertSha256(expectedSha256, `${label} hash`);
  const current = await regularInformation(filePath, label);
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
  await ensureDirectory(parent);
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
  const information = await regularInformation(filePath, label);
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
  };
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
    || !isObject(manifest.fileNaming)
    || !String(manifest.fileNaming.stem || "").trim()
    || !HTML_EXTENSIONS.has(String(manifest.fileNaming.extension || "").toLowerCase())
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
    ensureRelativePath(workingCopy.sourceRelativePath, "sourceRelativePath");
    ensureRelativePath(workingCopy.stateRelativePath, "stateRelativePath");
    workingCopyIds.add(workingCopy.workingCopyId);
  }
  return manifest;
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
  if (runtime.activeRequest !== null) {
    const active = runtime.activeRequest;
    if (
      !isObject(active)
      || !SAFE_REQUEST_ID.test(active.requestId)
      || !SAFE_REQUEST_ID.test(active.attemptId)
      || !["processing", "pending-review"].includes(active.status)
      || (active.candidateId !== null && !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(active.candidateId))
      || (active.status === "processing" && active.candidateId !== null)
      || (active.status === "pending-review" && active.candidateId !== runtime.activeCandidateId)
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
  const relative = ensureRelativePath(workingCopy.sourceRelativePath, "sourceRelativePath");
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
      if (!(await exists(this.#registryPath))) {
        await atomicWriteJson(this.#registryPath, emptyRegistry(this.#clock));
      }
      await this.#recoverPublishedImports();
    });
  }

  async importExternal({
    sourcePath,
    expectedSourceSha256 = null,
    duplicateResolution = null,
    forceNew = false,
  } = {}) {
    return this.#serial(() => this.#importExternal({
      sourcePath,
      expectedSourceSha256,
      duplicateResolution,
      forceNew,
    }));
  }

  async resolveOpenTarget({
    sourcePath,
    duplicateResolution = null,
  } = {}) {
    return this.#serial(() => this.#resolveOpenTarget({ sourcePath, duplicateResolution }));
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

  async reassociate({ projectRootPath, projectId } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#loadProject(projectRootPath);
      if (projectId && loaded.project.projectId !== projectId) {
        throw new ProjectFileRepositoryError(
          "PROJECT_ID_MISMATCH",
          "The selected folder belongs to another project.",
        );
      }
      await this.#writeRegistryAssociation(loaded.project.projectId, loaded.paths.projectRootPath);
      return {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        projectRootPath: loaded.paths.projectRootPath,
      };
    });
  }

  async workspace({ sourcePath, duplicateResolution = null } = {}) {
    return this.#serial(() => this.#workspace({ sourcePath, duplicateResolution }));
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
      const information = await regularInformation(filePath, "PROJECT.md");
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
      if (typeof content !== "string" || !content.trim()) {
        throw new ProjectFileRepositoryError(
          "INVALID_PROJECT_FILE",
          "PROJECT.md must be non-empty Markdown.",
        );
      }
      const filePath = path.join(loaded.paths.projectRootPath, "PROJECT.md");
      const information = await regularInformation(filePath, "PROJECT.md");
      if (!information) {
        throw new ProjectFileRepositoryError(
          "PROJECT_FILE_NOT_FOUND",
          "PROJECT.md was not found.",
        );
      }
      const previous = await readFile(filePath);
      const next = Buffer.from(content, "utf8");
      const updated = !previous.equals(next);
      if (updated) await atomicWriteFile(filePath, next);
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
    const current = this.#tail.then(operation, operation);
    this.#tail = current.catch(() => {});
    return current;
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
    const registry = await readJsonFile(this.#registryPath, "project registry");
    if (!registry) return emptyRegistry(this.#clock);
    if (
      registry.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || !isObject(registry.projects)
    ) {
      throw new ProjectFileRepositoryError(
        "UNSUPPORTED_REGISTRY_SCHEMA",
        "The project location Registry uses an unsupported schema.",
      );
    }
    return registry;
  }

  async #workspace({ sourcePath, duplicateResolution }) {
    let target = await this.#resolveOpenTarget({ sourcePath, duplicateResolution });
    if (!target) return null;
    // A Promotion transaction means the user already chose adoption.  Resume
    // it before exposing any workspace facts, so a crash cannot leave a
    // half-Version between Candidate review and a formal Version.
    const recovered = await this.#recoverProject(target.projectRootPath);
    if (recovered.length > 0) {
      target = await this.#resolveOpenTarget({ sourcePath, duplicateResolution });
      if (!target) return null;
    }
    const loaded = await this.#loadProject(target.projectRootPath);
    const workingCopy = target.workingCopyId
      ? loaded.manifest.workingCopies.find(
        (entry) => entry.workingCopyId === target.workingCopyId,
      )
      : null;
    const state = workingCopy
      ? await readJsonFile(workingCopyStatePath(loaded.paths, workingCopy), "Working Copy state")
      : null;
    const draft = workingCopy && state
      ? await readJsonFile(
        draftPathForState(loaded.paths, workingCopy, state),
        "Working Copy draft",
      )
      : null;
    const activeRequest = loaded.runtime.activeRequest
      ? await readJsonFile(
        path.join(
          requestRootPath(loaded.paths, loaded.runtime.activeRequest.requestId),
          "request.json",
        ),
        "active request.json",
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
    const source = await readHtmlFile(target.exactSourcePath, "managed HTML");
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
      content: source.html,
      sourceSha256: source.sha256,
      lastModifiedAt: source.lastModifiedAt,
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
    const existing = await readJsonFile(requestPath, "request.json");
    if (existing) {
      this.#assertRequestRecord(existing, loaded, { requestId: id, attemptId: attempt });
      if (existing.expectedSourceSha256 !== expected) {
        throw new ProjectFileRepositoryError(
          "REQUEST_COLLISION",
          "This Request id belongs to another frozen source state.",
        );
      }
      return this.#publicRequest(existing, loaded.paths.projectRootPath);
    }
    const latest = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const ordinal = latest.ordinal + 1;
    const proposedVersionId = versionId(ordinal);
    const idForCandidate = randomId("candidate");
    const inputRoot = path.join(requestRoot, "input", "base");
    const inputPath = path.join(inputRoot, "index.html");
    const outputRelativePath = `requests/${id}/attempts/${attempt}/output/candidate.html`;
    const outputPath = resolveRelative(
      loaded.paths.controlRoot,
      outputRelativePath,
      "request output path",
    );
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
      outputRelativePath,
      status: "processing",
      createdAt: nowIso(this.#clock),
      request: isObject(request) ? structuredClone(request) : {},
    };
    await ensureDirectory(path.dirname(inputPath));
    await writeFileNoReplace(inputPath, loaded.source.buffer, expected, "Request input HTML");
    await ensureDirectory(path.dirname(outputPath));
    const promptPath = path.join(requestRoot, "PROMPT.md");
    const promptBuffer = Buffer.from(String(prompt || ""), "utf8");
    await writeFileNoReplace(promptPath, promptBuffer, sha256(promptBuffer), "Request prompt");
    await atomicWriteJson(requestPath, record);
    loaded.runtime.activeRequest = {
      requestId: id,
      candidateId: null,
      attemptId: attempt,
      status: "processing",
    };
    loaded.runtime.activeCandidateId = null;
    await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
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
      outputRelativePath: record.outputRelativePath,
      ...(isObject(record.error) ? { error: structuredClone(record.error) } : {}),
    };
  }

  async #requestStatus({ target, requestId, attemptId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const record = await readJsonFile(path.join(requestRoot, "request.json"), "request.json");
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
    const completion = await readJsonFile(completionPath, "completion.json");
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
    const output = await readHtmlFile(outputPath, "finalized Candidate output");
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
    const record = await readJsonFile(requestPath, "request.json");
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
    await atomicWriteJson(requestPath, record);
    if (loaded.runtime.activeRequest?.requestId === requestId) {
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
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
    const state = await readJsonFile(statePath, "Working Copy state");
    const draftPath = draftPathForState(loaded.paths, loaded.workingCopy, state);
    const persisted = await readJsonFile(draftPath, "Working Copy draft");
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
      await atomicWriteJson(draftPath, stored);
      const draftText = jsonText(stored);
      await atomicWriteJson(statePath, {
        ...state,
        draftRelativePath: draftRelativePathFor(loaded.workingCopy),
        draftSha256: sha256(Buffer.from(draftText, "utf8")),
        draftRevision: activeDraft.draftRevision,
      });
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
      const snapshot = await readHtmlFile(snapshotPath, "Version snapshot");
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
    const record = await readJsonFile(requestPath, "request.json");
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
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
      await atomicWriteJson(requestPath, record);
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
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
      await atomicWriteJson(requestPath, record);
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
      return {
        status: "error",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    record.status = "candidate-ready";
    record.completedAt = nowIso(this.#clock);
    await atomicWriteJson(requestPath, record);
    return {
      status: "candidate-ready",
      request: this.#publicRequest(record, loaded.paths.projectRootPath),
      candidate: structuredClone(prepared.candidate),
    };
  }

  async #writeRegistryAssociation(projectId, projectRootPath) {
    await ensureDirectory(this.#projectsRoot);
    const registry = await this.#readRegistry();
    registry.projects[projectId] = {
      projectRootPath: normalizedPath(projectRootPath),
      updatedAt: nowIso(this.#clock),
    };
    registry.updatedAt = nowIso(this.#clock);
    await atomicWriteJson(this.#registryPath, registry);
  }

  async #removeRegistryAssociationIfMatches(projectId, projectRootPath) {
    const registry = await this.#readRegistry();
    const existing = registry.projects[projectId];
    if (!existing?.projectRootPath || !samePath(
      existing.projectRootPath,
      projectRootPath,
    )) return false;
    delete registry.projects[projectId];
    registry.updatedAt = nowIso(this.#clock);
    await atomicWriteJson(this.#registryPath, registry);
    return true;
  }

  // Import writes a complete recovery record before publishing the staged
  // folder. A process can die between rename() and the registry write, where
  // neither side alone is an authority. This is a deliberately bounded scan
  // of the configured project root (never a disk-wide lost-project search):
  // it completes only a structurally valid, unpublished import.
  async #recoverPublishedImports() {
    let entries;
    try {
      entries = await readdir(this.#projectsRoot, { withFileTypes: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return [];
      throw cause;
    }
    const recovered = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) {
        continue;
      }
      const projectRootPath = path.join(this.#projectsRoot, entry.name);
      try {
        const paths = projectPaths(projectRootPath);
        const importRecord = await readJsonFile(
          path.join(paths.recoveryRoot, "import.json"),
          "import recovery record",
        );
        if (
          !importRecord
          || importRecord.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
          || importRecord.kind !== "import"
          || importRecord.state !== "prepared"
        ) continue;
        const loaded = await this.#loadProject(projectRootPath);
        if (
          importRecord.projectId !== loaded.project.projectId
          || importRecord.documentId !== loaded.project.documentId
        ) continue;
        await this.#writeRegistryAssociation(
          loaded.project.projectId,
          loaded.paths.projectRootPath,
        );
        await atomicWriteJson(path.join(paths.recoveryRoot, "import.json"), {
          ...importRecord,
          state: "committed",
          committedAt: nowIso(this.#clock),
        });
        recovered.push(loaded.project.projectId);
      } catch {
        // Unrecognized user folders and user-altered .pageroot metadata are
        // not auto-repaired or removed by the import recovery pass.
      }
    }
    return recovered;
  }

  async #importExternal({
    sourcePath,
    expectedSourceSha256,
    duplicateResolution,
    forceNew,
  }) {
    await ensureDirectory(this.#projectsRoot);
    await this.#recoverPublishedImports();
    const requestedPath = normalizedPath(sourcePath);
    htmlExtension(requestedPath);
    const existingRoot = await this.#findProjectRoot(requestedPath);
    if (existingRoot && !forceNew) {
      const target = await this.#resolveOpenTarget({
        sourcePath: requestedPath,
        duplicateResolution,
      });
      return { imported: false, target };
    }
    const source = await readHtmlFile(requestedPath, "external HTML");
    if (expectedSourceSha256 && source.sha256 !== assertSha256(expectedSourceSha256, "expectedSourceSha256")) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The external HTML changed before import.",
        { expectedSourceSha256, actualSourceSha256: source.sha256 },
      );
    }
    const unsupportedResource = hasUnsupportedRelativeResource(source.html);
    if (unsupportedResource) {
      throw new ProjectFileRepositoryError(
        "UNSUPPORTED_RELATIVE_RESOURCE",
        "The external HTML has a relative resource that cannot be safely imported yet.",
        { resource: unsupportedResource },
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
    let registryAssociated = false;
    try {
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
      await ensureDirectory(path.dirname(snapshotPath));
      await atomicWriteFile(snapshotPath, source.buffer);
      await this.#hit("import-snapshot-written", { stagingRoot });
      await atomicWriteFile(visiblePath, source.buffer);
      const visibleInformation = await regularInformation(visiblePath, "initial Working Copy");
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
        stateRelativePath: `working-copies/${firstWorkingCopyId}.json`,
        fileIdentity: copyFileIdentity(visibleInformation),
      };
      const manifest = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        fileNaming: { stem, extension },
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
      await atomicWriteJson(paths.projectPath, project);
      await atomicWriteJson(paths.manifestPath, manifest);
      await atomicWriteJson(workingCopyStatePath(paths, firstWorkingCopy), workingState);
      await atomicWriteJson(paths.runtimePath, runtime);
      await atomicWriteJson(path.join(paths.recoveryRoot, "import.json"), {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        kind: "import",
        state: "prepared",
        projectId,
        documentId,
        externalSourceSha256: source.sha256,
        createdAt,
      });
      await atomicWriteFile(
        path.join(stagingRoot, "PROJECT.md"),
        Buffer.from(`# ${stem}\n\n`, "utf8"),
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
      await this.#writeRegistryAssociation(projectId, allocated.projectRootPath);
      registryAssociated = true;
      const publishedPaths = projectPaths(allocated.projectRootPath);
      await atomicWriteJson(path.join(publishedPaths.recoveryRoot, "import.json"), {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        kind: "import",
        state: "committed",
        projectId,
        documentId,
        externalSourceSha256: source.sha256,
        createdAt,
        committedAt: nowIso(this.#clock),
      });
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
      } else if (!registryAssociated) {
        await this.#removeRegistryAssociationIfMatches(
          projectId,
          allocated.projectRootPath,
        ).catch(() => {});
        await rm(allocated.projectRootPath, { recursive: true, force: true });
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

  async #findProjectRoot(sourcePath) {
    let current = path.dirname(normalizedPath(sourcePath));
    while (true) {
      const controlRoot = projectControlRoot(current);
      const projectPath = path.join(controlRoot, "project.json");
      const projectInformation = await regularInformation(projectPath, "project.json");
      if (projectInformation) {
        await directoryInformation(current, "project root");
        await directoryInformation(controlRoot, ".pageroot");
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
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
    if (!(await directoryInformation(paths.controlRoot, ".pageroot"))) {
      throw new ProjectFileRepositoryError(
        "PROJECT_CONTROL_NOT_FOUND",
        "The project folder no longer contains its PageRoot identity.",
        { projectRootPath: root },
      );
    }
    const project = assertProjectIdentity(await readJsonFile(paths.projectPath, "project.json"));
    const manifest = assertManifest(
      await readJsonFile(paths.manifestPath, "manifest.json"),
      project,
    );
    const runtime = assertRuntime(
      await readJsonFile(paths.runtimePath, "runtime-state.json"),
      project,
      manifest,
    );
    return { paths, project, manifest, runtime };
  }

  async #resolveOpenTarget({ sourcePath, duplicateResolution }) {
    const exactSourcePath = normalizedPath(sourcePath);
    htmlExtension(exactSourcePath);
    const source = await readHtmlFile(exactSourcePath, "HTML");
    const projectRootPath = await this.#findProjectRoot(exactSourcePath);
    if (!projectRootPath) return null;
    const loaded = await this.#loadProject(projectRootPath);
    await this.#assertRegistryAssociation(loaded, duplicateResolution);
    const target = await this.#targetForExactPath(loaded, exactSourcePath, source);
    if (!target) {
      throw new ProjectFileRepositoryError(
        "MANAGED_SOURCE_AMBIGUOUS",
        "This HTML is inside a PageRoot project but cannot be uniquely linked to a Working Copy.",
        { projectId: loaded.project.projectId, sourcePath: exactSourcePath },
      );
    }
    return target;
  }

  async #assertRegistryAssociation(loaded, duplicateResolution) {
    const registry = await this.#readRegistry();
    const record = registry.projects[loaded.project.projectId];
    const knownRoot = record?.projectRootPath ? normalizedPath(record.projectRootPath) : null;
    if (knownRoot && !samePath(knownRoot, loaded.paths.projectRootPath)) {
      const knownProject = await this.#tryReadProjectIdentity(knownRoot);
      if (knownProject?.projectId === loaded.project.projectId) {
        if (duplicateResolution !== "reassociate") {
          throw new ProjectFileRepositoryError(
            "DUPLICATE_PROJECT_ID",
            "Another folder with this project identity is still registered. Choose whether to reassociate it or import this HTML as a new project.",
            {
              projectId: loaded.project.projectId,
              knownProjectRootPath: knownRoot,
              selectedProjectRootPath: loaded.paths.projectRootPath,
              actions: ["reassociate", "import-as-new", "cancel"],
            },
          );
        }
      }
    }
    await this.#writeRegistryAssociation(loaded.project.projectId, loaded.paths.projectRootPath);
  }

  async #tryReadProjectIdentity(projectRootPath) {
    try {
      const candidate = projectPaths(projectRootPath);
      if (!(await directoryInformation(projectRootPath, "project root"))) return null;
      if (!(await directoryInformation(candidate.controlRoot, ".pageroot"))) return null;
      const project = await readJsonFile(candidate.projectPath, "project.json");
      return project ? assertProjectIdentity(project) : null;
    } catch {
      return null;
    }
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
    if (matching.length !== 1) return null;
    const workingCopy = matching[0];
    const relative = path.relative(paths.projectRootPath, exactSourcePath).split(path.sep).join("/");
    if (!relative || relative.startsWith("..") || relative.startsWith(".pageroot/")) return null;
    workingCopy.sourceRelativePath = ensureRelativePath(relative, "sourceRelativePath");
    workingCopy.fileIdentity = copyFileIdentity(source.information);
    await atomicWriteJson(paths.manifestPath, manifest);
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
    let projectRootPath = normalizedPath(target.projectRootPath);
    let loaded;
    try {
      loaded = await this.#loadProject(projectRootPath);
    } catch (cause) {
      if (
        cause?.code !== "UNSAFE_DIRECTORY"
        && cause?.code !== "PROJECT_ROOT_NOT_FOUND"
        && cause?.code !== "PROJECT_CONTROL_NOT_FOUND"
      ) throw cause;
      const relocated = await this.#locateWithinPreviousParent(projectId, projectRootPath);
      if (!relocated) {
        throw new ProjectFileRepositoryError(
          "PROJECT_RELOCATION_REQUIRED",
          "The current project moved. Its in-memory changes are retained; locate the project before saving.",
          { projectId, lastKnownProjectRootPath: projectRootPath },
        );
      }
      projectRootPath = relocated;
      loaded = await this.#loadProject(projectRootPath);
      await this.#writeRegistryAssociation(projectId, projectRootPath);
    }
    if (loaded.project.projectId !== projectId || loaded.project.documentId !== documentId) {
      throw new ProjectFileRepositoryError(
        "PROJECT_IDENTITY_CHANGED",
        "The project root no longer matches the active document identity.",
      );
    }
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === workingCopyIdValue,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError("WORKING_COPY_NOT_FOUND", "The active Working Copy no longer exists.");
    }
    let exactSourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    let sourceInformation = await regularInformation(exactSourcePath, "Working Copy");
    if (!sourceInformation || !sameFileIdentity(workingCopy.fileIdentity, copyFileIdentity(sourceInformation))) {
      const recoveredPath = await this.#findWorkingCopyByFileIdentity(
        loaded.paths.projectRootPath,
        workingCopy.fileIdentity,
      );
      if (!recoveredPath) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_RELOCATION_REQUIRED",
          "The active HTML was renamed or moved and cannot be uniquely recovered.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
      exactSourcePath = recoveredPath;
      sourceInformation = await regularInformation(exactSourcePath, "Working Copy");
      const relative = path.relative(loaded.paths.projectRootPath, exactSourcePath)
        .split(path.sep)
        .join("/");
      workingCopy.sourceRelativePath = ensureRelativePath(relative, "sourceRelativePath");
      workingCopy.fileIdentity = copyFileIdentity(sourceInformation);
      await atomicWriteJson(loaded.paths.manifestPath, loaded.manifest);
    }
    const source = await readHtmlFile(exactSourcePath, "Working Copy");
    return { ...loaded, workingCopy, exactSourcePath, source };
  }

  async #locateWithinPreviousParent(projectId, previousRootPath) {
    const parent = path.dirname(previousRootPath);
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = path.join(parent, entry.name);
      const project = await this.#tryReadProjectIdentity(candidate);
      if (project?.projectId === projectId) candidates.push(candidate);
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  async #findWorkingCopyByFileIdentity(projectRootPath, identity) {
    let entries;
    try {
      entries = await readdir(projectRootPath, { withFileTypes: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    }
    const matches = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      const candidate = path.join(projectRootPath, entry.name);
      if (!HTML_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const information = await regularInformation(candidate, "Working Copy");
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
    await atomicWriteJson(transactionPath, {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      kind: "save",
      state: "prepared",
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: loaded.workingCopy.workingCopyId,
      sourceRelativePath: loaded.workingCopy.sourceRelativePath,
      expectedSourceSha256: expected,
      targetSourceSha256: nextSha256,
      preparedAt: nowIso(this.#clock),
    });
    await this.#hit("save-prepared", { transactionPath });
    await atomicWriteFile(loaded.exactSourcePath, nextBuffer);
    const written = await readHtmlFile(loaded.exactSourcePath, "Working Copy");
    if (written.sha256 !== nextSha256) {
      throw new ProjectFileRepositoryError("SAVE_HASH_MISMATCH", "The saved Working Copy does not match its requested bytes.");
    }
    await this.#hit("save-source-written", { transactionPath });
    loaded.workingCopy.fileIdentity = copyFileIdentity(written.information);
    const statePath = workingCopyStatePath(loaded.paths, loaded.workingCopy);
    const currentState = await readJsonFile(statePath, "Working Copy state");
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
    await atomicWriteJson(statePath, nextState);
    await atomicWriteJson(loaded.paths.manifestPath, loaded.manifest);
    await atomicWriteJson(transactionPath, {
      ...(await readJsonFile(transactionPath, "save transaction")),
      state: "committed",
      committedAt: nowIso(this.#clock),
    });
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
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const request = String(requestId || "");
    if (!SAFE_REQUEST_ID.test(request)) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
    }
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
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
    await ensureDirectory(requestRoot);
    const outputPath = path.join(requestRoot, "candidate.html");
    const candidatePath = path.join(requestRoot, "candidate.json");
    const existingCandidate = await readJsonFile(candidatePath, "candidate.json");
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
    } else {
      const assessment = assessedCandidate(
        typeof assessmentBaseHtml === "string"
          ? assessmentBaseHtml
          : loaded.source.html,
        candidateHtml,
        this.#clock,
      );
      await writeFileNoReplace(outputPath, outputBuffer, outputSha256, "Candidate HTML");
      await atomicWriteJson(candidatePath, {
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
      });
    }
    loaded.runtime.activeRequest = {
      requestId: request,
      candidateId: id,
      attemptId: String(attemptId || "attempt_001"),
      status: "pending-review",
    };
    loaded.runtime.activeCandidateId = id;
    await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
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
    let candidate = candidatePath
      ? await readJsonFile(candidatePath, "candidate.json")
      : null;
    if (!candidate || candidate.candidateId !== requested) {
      ({ candidatePath, candidate } = await this.#findCandidateById(loaded, requested));
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
    const output = await readHtmlFile(outputPath, "Candidate HTML");
    if (output.sha256 !== candidate.outputSha256) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_HASH_MISMATCH",
        "The Candidate changed after validation and must be reviewed again.",
      );
    }
    return { candidate, candidatePath, outputPath, output };
  }

  async #findCandidateById(loaded, candidateId) {
    let entries;
    try {
      entries = await readdir(loaded.paths.requestsRoot, { withFileTypes: true });
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
      const candidate = await readJsonFile(candidatePath, "candidate.json");
      if (candidate?.candidateId === candidateId) matches.push({ candidatePath, candidate });
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
    current.candidate.status = "rejected";
    current.candidate.rejectedAt = nowIso(this.#clock);
    await atomicWriteJson(current.candidatePath, current.candidate);
    const requestPath = path.join(
      requestRootPath(loaded.paths, current.candidate.requestId),
      "request.json",
    );
    const request = await readJsonFile(requestPath, "request.json");
    if (request?.candidateId === current.candidate.candidateId) {
      request.status = "rejected";
      request.rejectedAt = nowIso(this.#clock);
      await atomicWriteJson(requestPath, request);
    }
    loaded.runtime.activeRequest = null;
    loaded.runtime.activeCandidateId = null;
    await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
    return {
      candidateId: current.candidate.candidateId,
      status: "rejected",
      latestOfficialVersionId: loaded.manifest.latestOfficialVersionId,
    };
  }

  async #promoteCandidate({ target, candidateId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const candidateState = await this.#readCandidateForLoaded(loaded, candidateId);
    const expectedSourceSha256 = assertSha256(
      candidateState.candidate.expectedSourceSha256,
      "Candidate expectedSourceSha256",
    );
    if (loaded.source.sha256 !== expectedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_SOURCE_CHANGED",
        "The Working Copy changed after Candidate validation and cannot be adopted yet.",
        {
          expectedSourceSha256,
          actualSourceSha256: loaded.source.sha256,
          candidateId: candidateState.candidate.candidateId,
        },
      );
    }
    const transactionId = `promote_${candidateState.candidate.candidateId}`;
    const transactionRoot = path.join(loaded.paths.transactionsRoot, transactionId);
    const transactionPath = path.join(transactionRoot, "transaction.json");
    let transaction = await readJsonFile(transactionPath, "promotion transaction");
    if (!transaction) {
      await ensureDirectory(transactionRoot);
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
        createdAt: nowIso(this.#clock),
      };
      await atomicWriteJson(transactionPath, transaction);
      await this.#hit("promotion-prepared", { transactionPath });
    }
    return this.#continuePromotion(loaded, candidateState, transactionRoot, transaction);
  }

  async #continuePromotion(loaded, candidateState, transactionRoot, transaction) {
    if (
      transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
      || transaction.candidateId !== candidateState.candidate.candidateId
    ) {
      throw new ProjectFileRepositoryError(
        "PROMOTION_TRANSACTION_MISMATCH",
        "The Promotion transaction belongs to another Candidate.",
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
      snapshotRelativePath: `versions/${transaction.versionId}/index.html`,
      sourceRequestId: transaction.requestId,
      sourceCandidateId: transaction.candidateId,
      createdAt: nowIso(this.#clock),
    };
    const snapshotPath = versionSnapshotPath(loaded.paths, version);
    const visibleName = visibleFileName(
      loaded.manifest.fileNaming.stem,
      version.ordinal,
      loaded.manifest.fileNaming.extension,
    );
    const visiblePath = path.join(loaded.paths.projectRootPath, visibleName);
    const nextWorkingCopy = {
      workingCopyId: workingCopyId(version.ordinal),
      versionId: version.versionId,
      basedOnVersionId: version.versionId,
      sourceRelativePath: visibleName,
      stateRelativePath: `working-copies/${workingCopyId(version.ordinal)}.json`,
      fileIdentity: null,
    };
    if (transaction.state === "prepared") {
      await ensureDirectory(path.dirname(snapshotPath));
      await writeFileNoReplace(
        snapshotPath,
        candidateState.output.buffer,
        transaction.candidateOutputSha256,
        "Version snapshot",
      );
      transaction.state = "snapshot-created";
      transaction.snapshotCreatedAt = nowIso(this.#clock);
      await atomicWriteJson(path.join(transactionRoot, "transaction.json"), transaction);
      await this.#hit("promotion-snapshot-created", { transactionRoot });
    }
    if (transaction.state === "snapshot-created") {
      const visible = await writeFileNoReplace(
        visiblePath,
        candidateState.output.buffer,
        transaction.candidateOutputSha256,
        "Version Working Copy",
      );
      nextWorkingCopy.fileIdentity = copyFileIdentity(visible.information);
      const statePath = workingCopyStatePath(loaded.paths, nextWorkingCopy);
      await atomicWriteJson(statePath, {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        workingCopyId: nextWorkingCopy.workingCopyId,
        basedOnVersionId: version.versionId,
        baseSha256: transaction.candidateOutputSha256,
        currentSha256: transaction.candidateOutputSha256,
        differsFromBase: false,
        draftId: `draft_${nextWorkingCopy.workingCopyId}`,
        draftRelativePath: draftRelativePathFor(nextWorkingCopy),
        draftSha256: null,
        draftRevision: 0,
        saveState: "saved",
        lastPersistedRevision: 0,
        lastSavedAt: nowIso(this.#clock),
        lastOpenedAt: nowIso(this.#clock),
      });
      transaction.state = "working-copy-created";
      transaction.workingCopyCreatedAt = nowIso(this.#clock);
      transaction.workingCopy = nextWorkingCopy;
      await atomicWriteJson(path.join(transactionRoot, "transaction.json"), transaction);
      await this.#hit("promotion-working-copy-created", { transactionRoot });
    }
    if (transaction.state === "working-copy-created") {
      const committedWorkingCopy = transaction.workingCopy;
      if (!committedWorkingCopy?.fileIdentity) {
        const information = await regularInformation(visiblePath, "Version Working Copy");
        committedWorkingCopy.fileIdentity = copyFileIdentity(information);
      }
      loaded.manifest.versions.push(version);
      loaded.manifest.workingCopies.push(committedWorkingCopy);
      loaded.manifest.latestOfficialVersionId = version.versionId;
      await atomicWriteJson(loaded.paths.manifestPath, loaded.manifest);
      transaction.state = "manifest-committed";
      transaction.manifestCommittedAt = nowIso(this.#clock);
      await atomicWriteJson(path.join(transactionRoot, "transaction.json"), transaction);
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
      await atomicWriteJson(candidateState.candidatePath, candidateState.candidate);
      const requestPath = path.join(
        requestRootPath(loaded.paths, candidateState.candidate.requestId),
        "request.json",
      );
      const request = await readJsonFile(requestPath, "request.json");
      if (request?.candidateId === candidateState.candidate.candidateId) {
        request.status = "promoted";
        request.promotedVersionId = committedVersion.versionId;
        request.promotedAt = nowIso(this.#clock);
        await atomicWriteJson(requestPath, request);
      }
      loaded.runtime.activeWorkingCopyId = committedWorkingCopy.workingCopyId;
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await atomicWriteJson(loaded.paths.runtimePath, loaded.runtime);
      transaction.state = "completed";
      transaction.completedAt = nowIso(this.#clock);
      await atomicWriteJson(path.join(transactionRoot, "transaction.json"), transaction);
      await this.#hit("promotion-completed", { transactionRoot });
    }
    const sourcePath = workingCopySourcePath(loaded.paths, committedWorkingCopy);
    const source = await readHtmlFile(sourcePath, "Version Working Copy");
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

  async #recoverProject(projectRootPath) {
    const loaded = await this.#loadProject(projectRootPath);
    const recovered = [];
    const entries = await readdir(loaded.paths.transactionsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith("promote_")) continue;
      const transactionRoot = path.join(loaded.paths.transactionsRoot, entry.name);
      const transaction = await readJsonFile(
        path.join(transactionRoot, "transaction.json"),
        "promotion transaction",
      );
      if (!transaction || transaction.kind !== "promotion" || transaction.state === "completed") continue;
      const candidatePath = path.join(
        loaded.paths.requestsRoot,
        transaction.requestId,
        "candidate.json",
      );
      const candidate = await readJsonFile(candidatePath, "candidate.json");
      if (!candidate) continue;
      const outputPath = resolveRelative(
        loaded.paths.controlRoot,
        candidate.outputRelativePath,
        "candidate output path",
      );
      const output = await readHtmlFile(outputPath, "Candidate HTML");
      recovered.push(await this.#continuePromotion(
        loaded,
        { candidate, candidatePath, outputPath, output },
        transactionRoot,
        transaction,
      ));
    }
    return recovered;
  }
}
