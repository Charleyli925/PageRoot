#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  rm,
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  atomicWriteFile,
  ensureDirectory,
  LIFECYCLE_SCHEMA_VERSION,
  LifecycleError,
  projectDisplayName,
  requireCompleteHtml,
  sha256,
  sha256Hex,
} from "./lifecycle-core.mjs";
import {
  PRODUCT_MAX_BRIDGE_BODY_BYTES,
  PRODUCT_MAX_HTML_BYTES,
} from "./product-contract.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "./project-file-repository.mjs";
import { createEmptySourceHistory } from "../shared/source-history.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const SERVICE_NAME = "html-ai-workspace-bridge";
const DEFAULT_WORKSPACE = path.join(
  os.homedir(),
  "Documents",
  "PageRoot",
  "项目记录",
);
const WORKSPACE_ROOT = path.resolve(
  process.env.HTML_AI_WORKSPACE || DEFAULT_WORKSPACE,
);
const DEFAULT_PROJECT_FILE_ROOT = path.join(
  os.homedir(),
  "Documents",
  "PageRoot",
  "项目",
);
const PROJECT_FILE_ROOT = path.resolve(
  process.env.HTML_AI_PROJECT_FILES_ROOT || DEFAULT_PROJECT_FILE_ROOT,
);
const projectFileRepository = new ProjectFileRepository({
  projectsRoot: PROJECT_FILE_ROOT,
  failpoint: process.env.HTML_AI_FAILPOINT
    ? async (name) => name === process.env.HTML_AI_FAILPOINT
    : null,
});
const FINALIZER_PATH = fileURLToPath(
  new URL("./finalize-attempt.mjs", import.meta.url),
);
const MAX_BODY_BYTES = PRODUCT_MAX_BRIDGE_BODY_BYTES;
const MAX_FILE_BYTES = PRODUCT_MAX_HTML_BYTES;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const BRIDGE_AUTH_TOKEN = process.env.HTML_AI_BRIDGE_AUTH_TOKEN || null;
const execFileAsync = promisify(execFile);

const configuredPort = Number.parseInt(
  process.env.HTML_AI_BRIDGE_PORT ?? String(DEFAULT_PORT),
  10,
);
if (
  !Number.isSafeInteger(configuredPort)
  || configuredPort < 1
  || configuredPort > 65_535
) {
  process.stderr.write(
    `${JSON.stringify({
      type: "fatal",
      error: {
        code: "INVALID_PORT",
        message: "HTML_AI_BRIDGE_PORT must be an integer from 1 to 65535.",
      },
    })}\n`,
  );
  process.exit(1);
}
const PORT = configuredPort;

class HttpError extends LifecycleError {
  constructor(status, code, message, details) {
    super(code, message, details, status);
    this.name = "HttpError";
  }
}

const PROJECT_NOT_FOUND_MESSAGE =
  "No v4 project file is registered for this source.";

function projectNotFoundError() {
  return new HttpError(404, "PROJECT_NOT_FOUND", PROJECT_NOT_FOUND_MESSAGE);
}

function requireFound(value) {
  if (!value) throw projectNotFoundError();
  return value;
}

function cleanText(value, maxLength = 10_000) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\0", "").trim().slice(0, maxLength);
}

function attachmentRecordId(value, label) {
  const normalized = cleanText(value, 180);
  if (!new RegExp(`^${label}_[A-Za-z0-9_-]+$`).test(normalized)) {
    throw new HttpError(
      422,
      `INVALID_${label.toUpperCase()}_ID`,
      `${label} id is invalid.`,
    );
  }
  return normalized;
}

function safeAttachmentFileName(value) {
  const baseName = path.posix.basename(
    String(value ?? "").replaceAll("\\", "/"),
  );
  const cleaned = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("/", "-")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new HttpError(422, "INVALID_ATTACHMENT_NAME", "Attachment file name is invalid.");
  }
  if (cleaned.length <= 180) return cleaned;
  const extension = path.extname(cleaned).slice(0, 24);
  return `${cleaned.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function attachmentMediaType(value) {
  const normalized = cleanText(value, 200) || "application/octet-stream";
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(normalized)) {
    return "application/octet-stream";
  }
  return normalized.toLowerCase();
}

function attachmentKind(value, mediaType, fileName) {
  if (value === "image") return "image";
  if (mediaType.startsWith("image/")) return "image";
  if (/\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(fileName)) {
    return "image";
  }
  return "file";
}

function decodeAttachmentBase64(value) {
  if (typeof value !== "string") {
    throw new HttpError(422, "INVALID_ATTACHMENT_DATA", "Attachment data is missing.");
  }
  const compact = value.replace(/\s+/g, "");
  if (
    compact.length === 0
    || compact.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw new HttpError(422, "INVALID_ATTACHMENT_DATA", "Attachment data is not valid base64.");
  }
  const buffer = Buffer.from(compact, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(
      buffer.byteLength > MAX_ATTACHMENT_BYTES ? 413 : 422,
      buffer.byteLength > MAX_ATTACHMENT_BYTES
        ? "ATTACHMENT_TOO_LARGE"
        : "EMPTY_ATTACHMENT",
      `Each attachment must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes.`,
    );
  }
  return buffer;
}

function resolveAttachmentPath(projectRoot, relativePath, { draftOnly = false } = {}) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  const allowed = draftOnly
    ? /^draft\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+$/
    : /^(?:draft\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+|requests\/req_[A-Za-z0-9_-]+\/input\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+)$/;
  if (!allowed.test(normalized)) {
    throw new HttpError(422, "INVALID_ATTACHMENT_PATH", "Attachment path is invalid.");
  }
  const absolutePath = path.resolve(projectRoot, ...normalized.split("/"));
  const projectPrefix = `${path.resolve(projectRoot)}${path.sep}`;
  if (!absolutePath.startsWith(projectPrefix)) {
    throw new HttpError(422, "INVALID_ATTACHMENT_PATH", "Attachment path escapes the project.");
  }
  return { relativePath: normalized, absolutePath };
}

function normalizeSourcePath(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new HttpError(
      400,
      "INVALID_SOURCE_PATH",
      "sourcePath must be an absolute HTML file path.",
    );
  }
  const normalized = path.normalize(value);
  if (
    !path.isAbsolute(normalized)
    || ![".html", ".htm"].includes(path.extname(normalized).toLowerCase())
  ) {
    throw new HttpError(
      400,
      "INVALID_SOURCE_PATH",
      "sourcePath must be an absolute .html or .htm path.",
    );
  }
  return normalized;
}

function requireSha256(value, label = "sha256") {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(
      400,
      "INVALID_SHA256",
      `${label} must use sha256:<64 lowercase hex>.`,
    );
  }
  return value;
}

async function inspectSourceFile(sourcePath, { requireComplete = true } = {}) {
  let information;
  try {
    information = await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(
        404,
        "SOURCE_NOT_FOUND",
        "The source HTML file was not found.",
      );
    }
    throw error;
  }
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new HttpError(
      409,
      "UNSAFE_SOURCE_FILE",
      "The source HTML must be a regular file, not a symbolic link.",
    );
  }
  if (information.size > MAX_FILE_BYTES) {
    throw new HttpError(413, "SOURCE_TOO_LARGE", "The source HTML is too large.");
  }
  const buffer = await readFile(sourcePath);
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new HttpError(
      415,
      "UNSUPPORTED_HTML_ENCODING",
      "The source HTML is not valid UTF-8 and was left unchanged.",
    );
  }
  if (requireComplete) requireCompleteHtml(html, "source HTML");
  return {
    buffer,
    html,
    sha256: sha256(buffer),
    information,
    lastModifiedAt: information.mtime.toISOString(),
  };
}

async function readSourceFile(sourcePath) {
  return inspectSourceFile(sourcePath, { requireComplete: true });
}

function projectFileHttpError(cause) {
  if (!(cause instanceof ProjectFileRepositoryError)) return cause;
  const code = String(cause.code || "PROJECT_FILE_ERROR");
  const status = code.startsWith("LEGACY_V4_REGISTRY_")
    ? 422
    : new Set([
    "SOURCE_NOT_FOUND",
    "PROJECT_ROOT_NOT_FOUND",
    "PROJECT_CONTROL_NOT_FOUND",
    "PROJECT_FILE_NOT_FOUND",
    "PROJECTS_ROOT_NOT_FOUND",
    "CANDIDATE_NOT_FOUND",
    "WORKING_COPY_NOT_FOUND",
    "VERSION_NOT_FOUND",
    "REGISTERED_PROJECT_UNAVAILABLE",
    "WORKING_COPY_UNAVAILABLE",
  ]).has(code)
    ? 404
    : new Set([
      "SOURCE_HASH_CONFLICT",
      "PROJECT_IDENTITY_CHANGED",
      "REGISTERED_PROJECT_PATH_MISMATCH",
      "REGISTERED_PROJECT_IDENTITY_CHANGED",
      "MANAGED_PATH_AMBIGUOUS",
      "MANAGED_SOURCE_IDENTITY_MISMATCH",
      "WORKING_COPY_CONFLICT",
      "AMBIGUOUS_SOURCE_FILE_IDENTITY",
      "ACTIVE_REQUEST_EXISTS",
      "STALE_CANDIDATE",
      "CANDIDATE_SOURCE_CHANGED",
      "CANDIDATE_NOT_PENDING_REVIEW",
      "CANDIDATE_AUTHORITY_MISMATCH",
      "CANDIDATE_HASH_MISMATCH",
      "REQUEST_OUTPUT_CHANGED",
      "FROZEN_INPUT_HASH_MISMATCH",
      "REQUEST_COLLISION",
      "FILE_COLLISION",
      "PROMOTION_PATH_REPLACED",
      "PROMOTION_PREPARED_PATH_CONFLICT",
      "PROMOTION_PREPARED_FILE_CHANGED",
      "PROMOTION_TRANSACTION_MISMATCH",
      "PROMOTION_TRANSACTION_INVALID",
      "PROMOTION_WORKING_COPY_MISSING",
      "PROMOTION_VERSION_MISSING",
      "IMPORT_REGISTRY_CONFLICT",
      "IMPORT_IDENTITY_MISMATCH",
      "IMPORT_RECOVERY_INVALID",
      "IMPORT_RECOVERY_AMBIGUOUS",
      "IMPORT_INTENT_NOT_FOUND",
      "REGISTERED_PROJECT_RACE",
      "WORKING_COPY_VERSION_MISMATCH",
      "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT",
      "HISTORY_ACTIVATION_RECEIPT_MISMATCH",
      "REQUEST_RUNTIME_ANCHOR_MISMATCH",
      "CANCELLATION_AUTHORITY_MISMATCH",
      "AI_TASK_NOT_ACTIVE",
    ]).has(code)
      ? 409
      : code === "UNSUPPORTED_HTML_ENCODING"
      ? 415
      : new Set([
        "UNSAFE_FILE",
        "UNSAFE_DIRECTORY",
        "UNSUPPORTED_HTML_EXTENSION",
        "INCOMPLETE_HTML",
        "PATH_ESCAPES_PROJECT",
        "INVALID_RELATIVE_PATH",
        "INVALID_ID",
        "INVALID_OPERATION_ID",
        "INVALID_RECONCILE_REASON",
        "INVALID_FILE_STEM",
        "PATH_COMPONENT_TOO_LONG",
        "INVALID_CANDIDATE_ID",
        "CANDIDATE_UNUSABLE",
        "CANDIDATE_VALIDATION_INVALID",
        "INVALID_REQUEST_ID",
        "INVALID_HISTORY_ACTIVATION_OPERATION",
        "INVALID_ATTEMPT_ID",
        "INVALID_REGISTRY",
        "UNSUPPORTED_REGISTRY_SCHEMA",
        "UNREGISTERED_PROJECT_ROOT",
        "WORKING_COPY_STATE_INVALID",
      ]).has(code)
        ? 422
        : 500;
  return new HttpError(status, code, cause.message, cause.details);
}

function registeredProjectId(value) {
  const projectId = String(value || "");
  if (!/^project_[a-f0-9]{16,64}$/u.test(projectId)) {
    throw new HttpError(400, "INVALID_PROJECT_ID", "projectId is invalid.");
  }
  return projectId;
}

async function registeredProjectCatalog() {
  try {
    return {
      ok: true,
      projects: await projectFileRepository.listRegisteredProjects(),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function registeredProjectOpen(projectId) {
  try {
    const resolved = await projectFileRepository.resolveRegisteredProjectOpenTarget({
      projectId: registeredProjectId(projectId),
    });
    return {
      ok: true,
      projectId: resolved.target.projectId,
      documentId: resolved.target.documentId,
      sourcePath: resolved.target.exactSourcePath,
      sourceSha256: resolved.sourceSha256,
      openTarget: resolved.target,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function reconcileManagedWorkingCopy(body = {}) {
  try {
    const reconciled = await projectFileRepository.reconcileWorkingCopyLocator({
      operationId: body.operationId,
      previousSourcePath: body.previousSourcePath,
      projectId: body.projectId,
      documentId: body.documentId,
      workingCopyId: body.workingCopyId,
      versionId: body.versionId,
      expectedSourceSha256: body.expectedSourceSha256,
      reason: body.reason,
    });
    return {
      ok: true,
      operationId: reconciled.operationId,
      status: reconciled.status,
      previousSourcePath: reconciled.previousSourcePath,
      sourcePath: reconciled.sourcePath,
      sourceSha256: reconciled.sourceSha256,
      openTarget: reconciled.openTarget,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileWorkspaceForSource(sourcePath) {
  try {
    return await projectFileRepository.workspace({ sourcePath });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

function projectFileTargetFromWorkspace(workspace) {
  if (!workspace?.target || workspace.target.targetKind !== "working-copy") {
    throw new HttpError(
      409,
      "WORKING_COPY_REQUIRED",
      "This operation requires an editable Working Copy, not an immutable Version snapshot.",
    );
  }
  return workspace.target;
}

function projectFileTargetFromBody(body = {}) {
  if (
    !body
    || typeof body !== "object"
    || !body.projectRootPath
    || !body.projectId
    || !body.documentId
    || !body.workingCopyId
  ) return null;
  return {
    projectId: String(body.projectId),
    documentId: String(body.documentId),
    projectRootPath: String(body.projectRootPath),
    targetKind: String(body.targetKind || "working-copy"),
    workingCopyId: String(body.workingCopyId),
    versionId: body.versionId ? String(body.versionId) : null,
    exactSourcePath: String(body.exactSourcePath || body.sourcePath || ""),
    sourceSha256: String(
      body.sourceSha256
      || body.expectedSourceSha256
      || "",
    ),
    sessionEpoch: Number(body.sessionEpoch || body.epoch || 0),
  };
}

function projectFileVersionRows(workspace) {
  return workspace.manifest.versions.map((version) => {
    const workingCopy = Array.isArray(workspace.workingCopies)
      ? workspace.workingCopies.find((entry) => entry.versionId === version.versionId)
      : null;
    return {
      schemaVersion: "4.0.0",
      ...version,
      sourceType: version.sourceCandidateId ? "internal-ai" : "initial",
      versionLabel: `V${version.ordinal}`,
      generatedAt: version.createdAt,
      requestId: version.sourceRequestId,
      attemptId: null,
      committed: true,
      workingCopyId: workingCopy?.workingCopyId || null,
      differsFromBase: workingCopy?.differsFromBase === true,
      saveState: workingCopy?.saveState || null,
    };
  });
}

function projectFileDraftState(workspace) {
  const state = workspace.draft || workspace.workingCopyState || {};
  return {
    draftRevision: Number(state.draftRevision || 0),
    comments: Array.isArray(state.comments) ? state.comments : [],
    changeEvents: Array.isArray(state.changeEvents) ? state.changeEvents : [],
    deletedCommentIds: Array.isArray(state.deletedCommentIds)
      ? state.deletedCommentIds
      : [],
    appliedOperationIds: Array.isArray(state.appliedOperationIds)
      ? state.appliedOperationIds
      : [],
  };
}

function projectFileActiveRun(workspace, target) {
  return projectFileRunForRequest({
    request: workspace.activeRequest,
    candidate: workspace.activeCandidate,
    target,
  });
}

function projectFileRunForRequest({ request, candidate = null, target }) {
  if (!request || typeof request !== "object") return null;
  const candidateReady = request.status === "candidate-ready" && candidate;
  const terminalStatus = ["no-change", "error"].includes(request.status)
    ? request.status
    : null;
  const status = candidateReady ? "ready-to-open" : terminalStatus || "processing";
  const sourcePath = target.exactSourcePath;
  const requestPath = path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const attemptPath = path.join(requestPath, "attempts", request.attemptId);
  const outputPath = path.join(
    target.projectRootPath,
    ".pageroot",
    ...String(request.outputRelativePath || "").split("/"),
  );
  const completion = candidateReady
    ? {
      completedAt: candidate.createdAt,
      projectId: request.projectId,
      documentId: request.documentId,
      requestId: request.requestId,
      attemptId: request.attemptId,
      versionId: candidate.proposedVersionId,
      contentSha256: candidate.outputSha256,
    }
    : null;
  const readyPayload = candidateReady
    ? {
      status: "ready-to-open",
      readyToOpen: true,
      projectId: request.projectId,
      documentId: request.documentId,
      requestId: request.requestId,
      attemptId: request.attemptId,
      versionId: candidate.proposedVersionId,
      candidateVersionId: candidate.proposedVersionId,
      candidateDisplayVersionLabel: `版本 ${candidate.proposedVersionOrdinal}`,
      contentSha256: candidate.outputSha256,
      sourceSha256: request.expectedSourceSha256,
      // A ready Candidate may belong to a background project while another
      // project is currently mounted. Carry its complete managed OpenTarget
      // so renderer activation never borrows identity fields from the screen.
      openTarget: target,
      version: {
        versionId: candidate.proposedVersionId,
        generatedAt: candidate.createdAt,
        contentSha256: candidate.outputSha256,
        projectId: request.projectId,
        documentId: request.documentId,
      },
      outcome: completion,
      completion,
    }
    : null;
  return {
    projectId: request.projectId,
    documentId: request.documentId,
    requestId: request.requestId,
    attemptId: request.attemptId,
    status,
    sourcePath,
    requestPath,
    attemptPath,
    promptPath: path.join(requestPath, "PROMPT.md"),
    outputPath,
    completionPath: path.join(attemptPath, "completion.json"),
    handoffMessage: String(
      request.request?.handoffMessage
      || `请执行 ${path.join(requestPath, "PROMPT.md")} 中的单轮任务，完成后运行其中的最终化（finalizer）命令。`,
    ),
    baseSnapshotSha256: request.expectedSourceSha256,
    previousVersionId: request.previousVersionId,
    basedOnVersionId: request.basedOnVersionId,
    freezeCutoffRevision: Number(request.request?.freezeCutoffRevision || 0),
    candidateVersionId: request.proposedVersionId,
    candidateVersionOrdinal: request.proposedVersionOrdinal,
    candidateVersionLabel: `版本 ${request.proposedVersionOrdinal}`,
    submittedAt: request.createdAt,
    summary: String(request.request?.summary || ""),
    commentCount: Array.isArray(request.request?.comments)
      ? request.request.comments.length
      : 0,
    changeEventCount: Array.isArray(request.request?.changeEvents)
      ? request.request.changeEvents.length
      : 0,
    ...(candidateReady ? {
      completionObserved: true,
      candidateOutputSha256: candidate.outputSha256,
      candidateAssessment: candidate.assessment,
      readyPayload,
    } : terminalStatus ? {
      completionObserved: true,
      ...(request.error ? { error: request.error } : {}),
    } : {}),
  };
}

function projectFileTerminalRunOutcome(workspace, target) {
  return projectFileRunForRequest({
    request: workspace.terminalRequest,
    target,
  });
}

function projectFileBaseWorkspaceState(workspace) {
  const target = workspace.target;
  const currentVersion = workspace.manifest.versions.find(
    (version) => version.versionId === target.versionId,
  ) || null;
  const currentExactVersionId = (
    target.targetKind === "working-copy"
    && currentVersion
    && workspace.sourceSha256 === currentVersion.contentSha256
  ) ? currentVersion.versionId : null;
  const activeDraft = projectFileDraftState(workspace);
  const activeRun = projectFileActiveRun(workspace, target);
  const recentRunOutcome = projectFileTerminalRunOutcome(workspace, target);
  const runtime = {
    lifecycleState: activeRun?.status || "ready",
    activeRun,
    conflict: null,
    editRevision: Number(workspace.workingCopyState?.lastPersistedRevision || 0),
    lastPersistedRevision: Number(workspace.workingCopyState?.lastPersistedRevision || 0),
    draft: activeDraft,
  };
  return {
    ok: true,
    registered: true,
    projectFileSchemaVersion: "4.0.0",
    workspace: PROJECT_FILE_ROOT,
    projectRoot: target.projectRootPath,
    paths: {
      currentHtml: target.exactSourcePath,
      projectRecords: target.projectRootPath,
    },
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
    sourcePath: target.exactSourcePath,
    openTarget: target,
    currentHtmlSha256: workspace.sourceSha256,
    sourceSha256: workspace.sourceSha256,
    lastModifiedAt: workspace.lastModifiedAt,
    latestVersionId: workspace.manifest.latestOfficialVersionId,
    currentBasedOnVersionId: target.versionId || null,
    currentExactVersionId,
    restoredFromVersionId: null,
    project: {
      schemaVersion: "4.0.0",
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      displayName: path.basename(target.projectRootPath),
      createdAt: workspace.project.createdAt,
      sourcePath: target.exactSourcePath,
      latestVersionId: workspace.manifest.latestOfficialVersionId,
      currentBasedOnVersionId: target.versionId || null,
      currentExactVersionId,
      currentHtmlSha256: workspace.sourceSha256,
    },
    runtimeState: runtime,
    activeRun,
    recentRunOutcome,
    activeDraft,
    workingCopyRecovered: workspace.workingCopyRecovered === true,
    recoveryIdentity: null,
    sourceHistory: createEmptySourceHistory({
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      sourceSha256: workspace.sourceSha256,
    }),
    versions: projectFileVersionRows(workspace),
    current: {
      path: target.exactSourcePath,
      entryPath: target.exactSourcePath,
      sha256: workspace.sourceSha256,
    },
    content: workspace.content,
  };
}

async function projectFileWorkspaceState(sourcePath, options = {}) {
  const workspace = await projectFileWorkspaceForSource(sourcePath, options);
  return workspace ? projectFileBaseWorkspaceState(workspace) : null;
}

function projectFileBodyIdentityMatches(workspace, body) {
  if (
    body.projectId
    && String(body.projectId) !== workspace.project.projectId
  ) return false;
  if (
    body.documentId
    && String(body.documentId) !== workspace.project.documentId
  ) return false;
  return true;
}

async function ensureProjectFile(body) {
  const expectedSourceSha256 = requireSha256(
    body.expectedSourceSha256,
    "expectedSourceSha256",
  );
  let imported;
  try {
    imported = await projectFileRepository.importExternal({
      sourcePath: normalizeSourcePath(body.sourcePath),
      expectedSourceSha256,
    });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
  const workspace = await projectFileWorkspaceForSource(imported.target.exactSourcePath);
  return {
    ...projectFileBaseWorkspaceState(workspace),
    imported: imported.imported,
  };
}

async function saveProjectFileAutosave(body) {
  const bodyTarget = projectFileTargetFromBody(body);
  if (bodyTarget && bodyTarget.targetKind !== "working-copy") {
    throw new HttpError(
      409,
      "WORKING_COPY_REQUIRED",
      "This operation requires an editable Working Copy.",
    );
  }
  const workspace = bodyTarget
    ? null
    : await projectFileWorkspaceForSource(body.sourcePath);
  if (!bodyTarget && !workspace) return null;
  if (workspace && !projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The autosave identity does not match the selected project file.",
    );
  }
  const target = bodyTarget || projectFileTargetFromWorkspace(workspace);
  const editRevision = Number(body.editRevision);
  if (!Number.isSafeInteger(editRevision) || editRevision < 1) {
    throw new HttpError(400, "INVALID_EDIT_REVISION", "editRevision must be a positive integer.");
  }
  let saved;
  try {
    saved = await projectFileRepository.saveWorkingCopy({
      target,
      html: body.html ?? body.baseHtml,
      expectedSourceSha256: requireSha256(
        body.expectedSourceSha256 ?? body.sourceSha256,
        "expectedSourceSha256",
      ),
      editRevision,
    });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
  const next = await projectFileWorkspaceForSource(saved.target.exactSourcePath);
  const state = projectFileBaseWorkspaceState(next);
  return {
    ok: true,
    status: "saved",
    projectId: next.project.projectId,
    documentId: next.project.documentId,
    sourcePath: saved.target.exactSourcePath,
    openTarget: saved.target,
    content: next.content,
    sha256: saved.currentSha256,
    sourceSha256: saved.currentSha256,
    currentHtmlSha256: saved.currentSha256,
    lastModifiedAt: next.lastModifiedAt,
    persistedRevision: saved.lastPersistedRevision,
    lastPersistedRevision: saved.lastPersistedRevision,
    versionCreated: false,
    currentExactVersionId: state.currentExactVersionId,
    sourceHistory: state.sourceHistory,
    activeDraft: state.activeDraft,
    recoveryIdentity: null,
  };
}

async function sourceProjectFile(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  const state = projectFileBaseWorkspaceState(workspace);
  return {
    ok: true,
    registered: true,
    projectFileSchemaVersion: "4.0.0",
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
    sourcePath: workspace.target.exactSourcePath,
    openTarget: workspace.target,
    content: workspace.content,
    sha256: workspace.sourceSha256,
    sourceSha256: workspace.sourceSha256,
    currentBasedOnVersionId: state.currentBasedOnVersionId,
    currentExactVersionId: state.currentExactVersionId,
    restoredFromVersionId: null,
    lastModifiedAt: workspace.lastModifiedAt,
  };
}

async function projectFileTargetForBody(body = {}) {
  const direct = projectFileTargetFromBody(body);
  if (direct) return direct;
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  return workspace?.target || null;
}

function projectFileFinalizerCommand(target, request) {
  const nodeRuntime = process.versions.electron
    ? `ELECTRON_RUN_AS_NODE=1 ${shellQuoted(process.execPath)}`
    : shellQuoted(process.execPath);
  return [
    nodeRuntime,
    shellQuoted(FINALIZER_PATH),
    "--project-root",
    shellQuoted(target.projectRootPath),
    "--request-id",
    shellQuoted(request.requestId),
    "--attempt-id",
    shellQuoted(request.attemptId),
  ].join(" ");
}

function projectFilePromptForRequest(target, request, body) {
  const requestRoot = path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const inputPath = path.join(requestRoot, "input", "base", "index.html");
  const inputManifestPath = path.join(requestRoot, "input-manifest.json");
  const changeRequestPath = path.join(requestRoot, "change-request.json");
  const projectRulesPath = path.join(requestRoot, "input", "PROJECT.md");
  const annotationsPath = path.join(requestRoot, "input", "annotations", "records.json");
  const outputPath = path.join(
    target.projectRootPath,
    ".pageroot",
    ...String(request.outputRelativePath || "").split("/"),
  );
  const summary = String(body.summary || "根据本轮评论和要求生成新的完整 HTML。").trim();
  return `# PageRoot AI Candidate\n\n## 任务\n\n${summary}\n\n## 冻结输入\n\n严格按 \`${inputManifestPath}\` 的 \`readOrder\` 读取。该清单包含：\n\n- 本轮要求：\`${changeRequestPath}\`\n- 项目长期规则：\`${projectRulesPath}\`\n- 冻结 HTML：\`${inputPath}\`\n- 冻结评论、目标与编辑记录：\`${annotationsPath}\`\n\n这些文件及可见 Working Copy、任何 Version、PROJECT.md 都是只读的。只将一个完整 HTML 写入：\`${outputPath}\`。\n\nPageRoot 会校验输出的完整文档和页面连续性；校验通过后它仍只是待审阅 Candidate。只有用户明确采纳后才会成为正式 Version。\n\n## 完成\n\n输出写完后，执行唯一最终化命令：\n\n\`\`\`sh\n${projectFileFinalizerCommand(target, request)}\n\`\`\`\n`;
}

function projectFileReadyPayload({ request, candidate, target }) {
  const completedAt = String(candidate.createdAt || request.createdAt || nowIso());
  const version = {
    versionId: candidate.proposedVersionId,
    generatedAt: completedAt,
    contentSha256: candidate.outputSha256,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
  };
  const completion = {
    completedAt,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
    requestId: candidate.requestId,
    attemptId: candidate.attemptId,
    versionId: candidate.proposedVersionId,
    contentSha256: candidate.outputSha256,
  };
  return {
    ok: true,
    status: "ready-to-open",
    readyToOpen: true,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
    sourcePath: target.exactSourcePath,
    currentPath: target.exactSourcePath,
    workingCopyPath: target.exactSourcePath,
    openTarget: target,
    requestId: candidate.requestId,
    attemptId: candidate.attemptId,
    versionId: candidate.proposedVersionId,
    candidateVersionId: candidate.proposedVersionId,
    candidateVersionLabel: `V${candidate.proposedVersionOrdinal}`,
    candidateDisplayVersionLabel: `版本 ${candidate.proposedVersionOrdinal}`,
    contentSha256: candidate.outputSha256,
    sourceSha256: candidate.expectedSourceSha256,
    currentHtmlSha256: candidate.expectedSourceSha256,
    version,
    completion,
    outcome: completion,
    candidate,
    candidateAssessment: candidate.assessment,
    activeRun: {
      projectId: candidate.projectId,
      documentId: candidate.documentId,
      requestId: candidate.requestId,
      attemptId: candidate.attemptId,
      status: "ready-to-open",
      sourcePath: target.exactSourcePath,
      requestPath: path.join(target.projectRootPath, ".pageroot", "requests", candidate.requestId),
      attemptPath: path.join(target.projectRootPath, ".pageroot", "requests", candidate.requestId, "attempts", candidate.attemptId),
      handoffMessage: String(request.request?.handoffMessage || ""),
      baseSnapshotSha256: candidate.expectedSourceSha256,
      previousVersionId: candidate.previousVersionId,
      basedOnVersionId: candidate.basedOnVersionId,
      freezeCutoffRevision: Number(request.request?.freezeCutoffRevision || 0),
      candidateVersionId: candidate.proposedVersionId,
      candidateVersionOrdinal: candidate.proposedVersionOrdinal,
      candidateVersionLabel: `版本 ${candidate.proposedVersionOrdinal}`,
      submittedAt: request.createdAt,
      summary: String(request.request?.summary || ""),
      commentCount: Array.isArray(request.request?.comments)
        ? request.request.comments.length
        : 0,
      changeEventCount: Array.isArray(request.request?.changeEvents)
        ? request.request.changeEvents.length
        : 0,
      completionObserved: true,
      candidateOutputSha256: candidate.outputSha256,
      candidateAssessment: candidate.assessment,
    },
  };
}

async function saveProjectFileDraft(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  if (target.targetKind !== "working-copy") {
    throw new HttpError(409, "WORKING_COPY_REQUIRED", "Drafts belong to an editable Working Copy.");
  }
  try {
    const saved = await projectFileRepository.saveDraft({
      target,
      operationId: body.operationId,
      expectedDraftRevision: body.expectedDraftRevision,
      basedOnVersionId: body.basedOnVersionId,
      comments: body.comments,
      changeEvents: body.changeEvents,
      deletedCommentIds: body.deletedCommentIds,
    });
    return {
      ok: true,
      projectId: target.projectId,
      documentId: target.documentId,
      ...saved,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function createProjectFileRequest(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  if (target.targetKind !== "working-copy") {
    throw new HttpError(409, "WORKING_COPY_REQUIRED", "AI Requests require an editable Working Copy.");
  }
  const requestId = `req_${randomUUID().replaceAll("-", "")}`;
  const attemptId = "attempt_001";
  const request = {
    freezeCutoffRevision: Number(body.freezeCutoffRevision || 0),
    summary: String(body.summary || ""),
    comments: Array.isArray(body.comments) ? body.comments : [],
    changeEvents: Array.isArray(body.changeEvents) ? body.changeEvents : [],
    instructions: Array.isArray(body.instructions) ? body.instructions : [],
    targets: Array.isArray(body.targets) ? body.targets : [],
    preserveOutsideTargets: true,
  };
  const promptDescriptor = {
    requestId,
    attemptId,
    outputRelativePath: `requests/${requestId}/attempts/${attemptId}/output/candidate.html`,
  };
  const handoffMessage = `请执行 ${path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    requestId,
    "PROMPT.md",
  )} 中的单轮任务，完成后运行其中的最终化（finalizer）命令。`;
  const prompt = projectFilePromptForRequest(target, promptDescriptor, body);
  try {
    const durable = await projectFileRepository.prepareRequest({
      target,
      requestId,
      attemptId,
      expectedSourceSha256: requireSha256(
        body.expectedSourceSha256 ?? body.sourceSha256,
        "expectedSourceSha256",
      ),
      request: { ...request, handoffMessage },
      prompt,
    });
    const run = projectFileActiveRun({
      activeRequest: durable,
      activeCandidate: null,
    }, target);
    return {
      ok: true,
      ...durable,
      candidateVersionId: durable.proposedVersionId,
      candidateDisplayVersionLabel: `版本 ${durable.proposedVersionOrdinal}`,
      projectRoot: target.projectRootPath,
      inputPath: path.join(
        target.projectRootPath,
        ".pageroot",
        "requests",
        requestId,
        "input",
        "base",
        "index.html",
      ),
      attemptPath: run.attemptPath,
      outputPath: run.outputPath,
      completionPath: run.completionPath,
      activeRun: run,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileRequestStatus(sourcePath, requestId, attemptId) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  try {
    const status = await projectFileRepository.requestStatus({
      target: projectFileTargetFromWorkspace(workspace),
      requestId,
      attemptId,
    });
    if (status.status === "candidate-ready") {
      const refreshed = await projectFileWorkspaceForSource(workspace.target.exactSourcePath);
      return projectFileReadyPayload({
        request: status.request,
        candidate: status.candidate,
        target: refreshed.target,
      });
    }
    return {
      ok: true,
      status: status.status,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      sourcePath: workspace.target.exactSourcePath,
      openTarget: workspace.target,
      requestId,
      attemptId,
      activeRun: projectFileActiveRun(workspace, workspace.target),
      ...(status.request ? { request: status.request } : {}),
      ...(status.request?.error ? { error: status.request.error } : {}),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function activateProjectFileCandidate(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  try {
    const promoted = await projectFileRepository.promoteCandidate({
      target,
      // `versionId` is a proposed Version label in the renderer protocol, not
      // the opaque Candidate id owned by the v4 repository.  Do not let that
      // label select a different Candidate (or turn a valid adoption into an
      // invalid-id error).
      candidateId: body.candidateId || null,
    });
    const workspace = await projectFileWorkspaceForSource(promoted.target.exactSourcePath);
    const source = workspace.content;
    return {
      ok: true,
      status: "version-activated",
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      versionId: promoted.version.versionId,
      sourcePath: promoted.target.exactSourcePath,
      currentPath: promoted.target.exactSourcePath,
      workingCopyPath: promoted.target.exactSourcePath,
      openTarget: promoted.target,
      contentSha256: promoted.version.contentSha256,
      sourceSha256: promoted.version.contentSha256,
      currentHtmlSha256: promoted.version.contentSha256,
      lastModifiedAt: workspace.lastModifiedAt,
      version: {
        ...promoted.version,
        generatedAt: promoted.version.createdAt,
        projectId: workspace.project.projectId,
        documentId: workspace.project.documentId,
      },
      content: source,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function cancelProjectFileRequest(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  try {
    const cancelled = await projectFileRepository.cancelRequest({
      target,
      requestId: body.requestId,
      attemptId: body.attemptId || "attempt_001",
    });
    return {
      ok: true,
      projectId: target.projectId,
      documentId: target.documentId,
      ...cancelled,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileVersionFile(sourcePath, versionId) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  try {
    const file = await projectFileRepository.readVersionFile({
      target: projectFileTargetFromWorkspace(workspace),
      versionId,
    });
    const visibleWorkingCopy = file.kind === "version"
      ? await projectFileRepository.resolveVersionWorkingCopy({
        target: projectFileTargetFromWorkspace(workspace),
        versionId,
      })
      : null;
    return {
      ok: true,
      projectFileSchemaVersion: "4.0.0",
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      projectRootPath: workspace.target.projectRootPath,
      versionId: file.version.versionId,
      content: file.content,
      sha256: file.sha256,
      contentSha256: file.sha256,
      path: file.path,
      relativePath: file.kind === "candidate"
        ? file.candidate.outputRelativePath
        : file.version.snapshotRelativePath,
      readOnly: true,
      ...(visibleWorkingCopy ? {
        workingCopyId: visibleWorkingCopy.workingCopyId,
        visibleWorkingCopyPath: visibleWorkingCopy.workingCopyPath,
        workingCopySha256: visibleWorkingCopy.sourceSha256,
      } : {}),
      ...(file.kind === "candidate" ? { candidate: file.candidate } : {}),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileAiTask(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  try {
    const projection = await projectFileRepository.materializeCurrentAiTaskProjection({
      target: projectFileTargetFromWorkspace(workspace),
    });
    return {
      ok: true,
      projectFileSchemaVersion: "4.0.0",
      projectId: projection.projectId,
      documentId: projection.documentId,
      sourcePath: workspace.target.exactSourcePath,
      projectRootPath: projection.projectRootPath,
      requestId: projection.requestId,
      attemptId: projection.attemptId,
      candidateId: projection.candidateId,
      status: projection.status,
      aiTaskPath: projection.taskPath,
      aiTaskRelativePath: projection.taskRelativePath,
      candidatePath: projection.candidatePath,
      candidateSha256: projection.candidateSha256,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function continueProjectFileHistoryVersion(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_HISTORY_CONTINUE", "The history continuation payload is invalid.");
  }
  const allowedKeys = new Set([
    "sourcePath",
    "projectId",
    "documentId",
    "versionId",
    "operationId",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "INVALID_HISTORY_CONTINUE", "The history continuation payload has unsupported fields.");
  }
  if (!/^ver_\d{4,}$/.test(String(body.versionId || ""))) {
    throw new HttpError(400, "INVALID_VERSION_ID", "versionId is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(String(body.operationId || ""))) {
    throw new HttpError(400, "INVALID_OPERATION_ID", "operationId is invalid.");
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) return null;
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The history continuation identity does not match the selected project.",
    );
  }
  try {
    const sourceTarget = projectFileTargetFromWorkspace(workspace);
    const activated = await projectFileRepository.activateVersionWorkingCopy({
      target: sourceTarget,
      versionId: String(body.versionId),
      operationId: String(body.operationId),
      expectedActiveWorkingCopyId: sourceTarget.workingCopyId,
    });
    const next = await projectFileWorkspaceForSource(activated.target.exactSourcePath);
    return {
      ...projectFileBaseWorkspaceState(next),
      status: "history-working-copy-activated",
      historyActivation: activated.historyActivation,
      operationId: activated.historyActivation.operationId,
      replayed: activated.replayed === true,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function confirmProjectFileHistoryVersion(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_HISTORY_CONFIRM", "The history activation confirmation payload is invalid.");
  }
  const allowedKeys = new Set([
    "sourcePath",
    "projectId",
    "documentId",
    "previousWorkingCopyId",
    "activatedWorkingCopyId",
    "versionId",
    "operationId",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "INVALID_HISTORY_CONFIRM", "The history activation confirmation payload has unsupported fields.");
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) return null;
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The history activation confirmation identity does not match the selected project.",
    );
  }
  if (
    body.previousWorkingCopyId !== null
    && !/^work_ver_\d{4,}$/.test(String(body.previousWorkingCopyId || ""))
  ) {
    throw new HttpError(400, "INVALID_WORKING_COPY_ID", "previousWorkingCopyId is invalid.");
  }
  if (
    !/^[A-Za-z0-9_-]{8,160}$/.test(String(body.operationId || ""))
    || !/^work_ver_\d{4,}$/.test(String(body.activatedWorkingCopyId || ""))
    || !/^ver_\d{4,}$/.test(String(body.versionId || ""))
  ) {
    throw new HttpError(400, "INVALID_HISTORY_CONFIRM", "The history activation confirmation is invalid.");
  }
  try {
    const confirmed = await projectFileRepository.confirmVersionWorkingCopyActivation({
      target: projectFileTargetFromWorkspace(workspace),
      operationId: String(body.operationId),
      previousWorkingCopyId: body.previousWorkingCopyId,
      activatedWorkingCopyId: String(body.activatedWorkingCopyId),
      versionId: String(body.versionId),
    });
    return {
      ok: true,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      status: "history-working-copy-desktop-confirmed",
      historyActivation: confirmed.historyActivation,
      confirmed: confirmed.confirmed,
      operationId: confirmed.historyActivation.operationId,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

function shellQuoted(value) {
  return JSON.stringify(String(value));
}

async function unmanagedWorkspaceState(sourcePath) {
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  const source = await readSourceFile(normalizedSourcePath);
  return {
    ok: true,
    registered: false,
    workspace: WORKSPACE_ROOT,
    projectRoot: null,
    paths: {
      currentHtml: normalizedSourcePath,
      projectRecords: null,
    },
    projectId: null,
    documentId: null,
    sourcePath: normalizedSourcePath,
    currentHtmlSha256: source.sha256,
    sourceSha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
    latestVersionId: null,
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    restoredFromVersionId: null,
    project: {
      displayName: projectDisplayName(normalizedSourcePath),
      sourcePath: normalizedSourcePath,
    },
    runtimeState: {
      lifecycleState: "preview",
      editRevision: 0,
      lastPersistedRevision: 0,
      activeRun: null,
      conflict: null,
    },
    activeRun: null,
    recentRunOutcome: null,
    activeDraft: null,
    recoveryIdentity: null,
    versions: [],
    current: {
      path: normalizedSourcePath,
      entryPath: normalizedSourcePath,
      sha256: source.sha256,
    },
  };
}

async function unmanagedSourceFile(sourcePath) {
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  const source = await readSourceFile(normalizedSourcePath);
  return {
    ok: true,
    registered: false,
    projectId: null,
    documentId: null,
    sourcePath: normalizedSourcePath,
    content: source.html,
    sha256: source.sha256,
    sourceSha256: source.sha256,
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    restoredFromVersionId: null,
    lastModifiedAt: source.lastModifiedAt,
  };
}

async function workspaceState(sourcePath) {
  const projectFileState = await projectFileWorkspaceState(sourcePath);
  return projectFileState || unmanagedWorkspaceState(sourcePath);
}

async function sourceFile(sourcePath) {
  const projectFileSource = await sourceProjectFile(sourcePath);
  return projectFileSource || unmanagedSourceFile(sourcePath);
}

async function ensureProject(body) {
  return ensureProjectFile(body);
}

async function saveAutosave(body) {
  return requireFound(await saveProjectFileAutosave(body));
}

async function saveDraft(body) {
  return requireFound(await saveProjectFileDraft(body));
}

async function createRequest(body) {
  return requireFound(await createProjectFileRequest(body));
}

async function activateReadyVersion(body) {
  return requireFound(await activateProjectFileCandidate(body));
}

async function statusFor(sourcePath, requestId, attemptId = "attempt_001") {
  return requireFound(
    await projectFileRequestStatus(sourcePath, requestId, attemptId),
  );
}

async function cancelActiveRun(body) {
  return requireFound(await cancelProjectFileRequest(body));
}

async function versionFile(sourcePath, versionId) {
  return requireFound(await projectFileVersionFile(sourcePath, versionId));
}

async function requireEditableProjectFileTarget(body) {
  const direct = projectFileTargetFromBody(body);
  if (direct) {
    if (direct.targetKind !== "working-copy") {
      throw new HttpError(
        409,
        "WORKING_COPY_REQUIRED",
        "This operation requires an editable Working Copy.",
      );
    }
    return direct;
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The project file identity does not match the selected project.",
    );
  }
  return projectFileTargetFromWorkspace(workspace);
}

async function saveDraftAttachment(body) {
  const target = await requireEditableProjectFileTarget(body);
  const commentId = attachmentRecordId(body.commentId, "comment");
  const attachmentId = attachmentRecordId(body.attachmentId, "attachment");
  const fileName = safeAttachmentFileName(body.fileName);
  const mediaType = attachmentMediaType(body.mediaType);
  const buffer = decodeAttachmentBase64(body.dataBase64);
  if (
    body.byteLength !== undefined
    && Number(body.byteLength) !== buffer.byteLength
  ) {
    throw new HttpError(
      422,
      "ATTACHMENT_LENGTH_MISMATCH",
      "Attachment byteLength does not match its decoded data.",
    );
  }
  const relativePath = [
    "draft",
    "attachments",
    commentId,
    `${attachmentId}-${fileName}`,
  ].join("/");
  const { absolutePath } = resolveAttachmentPath(
    target.projectRootPath,
    relativePath,
    { draftOnly: true },
  );
  await ensureDirectory(path.dirname(absolutePath));
  await atomicWriteFile(absolutePath, buffer);
  return {
    ok: true,
    projectId: target.projectId,
    documentId: target.documentId,
    attachment: {
      attachmentId,
      kind: attachmentKind(body.kind, mediaType, fileName),
      fileName,
      mediaType,
      byteLength: buffer.byteLength,
      sha256: sha256(buffer),
      relativePath,
      source: body.source === "clipboard" ? "clipboard" : "file-picker",
    },
  };
}

async function readAttachment(sourcePath, relativePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) throw projectNotFoundError();
  const resolved = resolveAttachmentPath(
    workspace.target.projectRootPath,
    relativePath,
  );
  const information = await lstat(resolved.absolutePath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment was not found.");
    }
    throw error;
  });
  if (
    !information.isFile()
    || information.isSymbolicLink()
    || information.size <= 0
    || information.size > MAX_ATTACHMENT_BYTES
  ) {
    throw new HttpError(422, "INVALID_ATTACHMENT_FILE", "Attachment file is not safe to read.");
  }
  return {
    buffer: await readFile(resolved.absolutePath),
    fileName: path.basename(resolved.absolutePath).replace(
      /^attachment_[A-Za-z0-9_-]+-/,
      "",
    ),
  };
}

async function deleteDraftAttachment(body) {
  const target = await requireEditableProjectFileTarget(body);
  const relativePath = String(body.relativePath ?? "").replaceAll("\\", "/");
  if (!relativePath.startsWith("draft/attachments/")) {
    return { ok: true, removed: false, retainedImmutableCopy: true };
  }
  const resolved = resolveAttachmentPath(
    target.projectRootPath,
    relativePath,
    { draftOnly: true },
  );
  await rm(resolved.absolutePath, { force: true });
  await rm(path.dirname(resolved.absolutePath)).catch(() => {});
  return { ok: true, removed: true };
}

async function runSourceHistoryAction(body) {
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The source-history identity does not match the selected project.",
    );
  }
  const source = await readSourceFile(workspace.target.exactSourcePath);
  const sourceHistory = createEmptySourceHistory({
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
    sourceSha256: source.sha256,
  });
  return {
    ok: true,
    status: "history-no-op",
    replayed: false,
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
    sourcePath: workspace.target.exactSourcePath,
    openTarget: workspace.target,
    persistedRevision: Number(workspace.workingCopyState?.lastPersistedRevision || 0),
    lastPersistedRevision: Number(workspace.workingCopyState?.lastPersistedRevision || 0),
    currentHtmlSha256: source.sha256,
    sourceSha256: source.sha256,
    sha256: source.sha256,
    content: source.html,
    lastModifiedAt: source.lastModifiedAt,
    sourceHistory,
    versionCreated: false,
  };
}

async function autosaveConflictCandidate(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) throw projectNotFoundError();
  return { ok: true };
}

async function resolveConflict(body) {
  const action = String(body.action || body.resolution || "");
  if (action === "force-unlock") {
    try {
      const unlocked = await projectFileRepository.forceUnlockWorkingCopy({
        sourcePath: requiredSourcePath(body.sourcePath),
      });
      return { ok: true, ...unlocked };
    } catch (cause) {
      throw projectFileHttpError(cause);
    }
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) throw projectNotFoundError();
  throw new HttpError(
    404,
    "CONFLICT_NOT_FOUND",
    "No conflict exists for this v4 project.",
  );
}

async function sourcePreview(sourcePath) {
  const source = await inspectSourceFile(sourcePath, { requireComplete: true });
  return {
    ok: true,
    content: source.html,
    sha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
    size: source.information.size,
  };
}

async function sourceStat(sourcePath) {
  const source = await inspectSourceFile(sourcePath, { requireComplete: false });
  return {
    ok: true,
    sha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
    size: source.information.size,
  };
}

async function inspectProjectFile(sourcePath, relativePath) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  const normalized = cleanText(relativePath, 500).replaceAll("\\", "/");
  if (normalized !== "PROJECT.md") {
    throw new HttpError(
      403,
      "PROJECT_FILE_NOT_INSPECTABLE",
      "The requested project file is not available in the read-only inspector.",
    );
  }
  return {
    ...await projectFileGet(sourcePath),
    readOnly: false,
  };
}

async function projectFileGet(sourcePath) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  try {
    const notes = await projectFileRepository.readProjectNotes({
      target: projectFileTargetFromWorkspace(projectFileWorkspace),
    });
    return {
      ok: true,
      projectId: notes.projectId,
      documentId: notes.documentId,
      sourcePath: projectFileWorkspace.target.exactSourcePath,
      content: notes.content,
      sha256: notes.sha256,
      updatedAt: notes.updatedAt,
      path: notes.path,
      relativePath: "PROJECT.md",
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileUpdate(body) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(projectFileWorkspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The project file identity does not match the selected project.",
    );
  }
  try {
    const notes = await projectFileRepository.updateProjectNotes({
      target: projectFileTargetFromWorkspace(projectFileWorkspace),
      content: body.content,
    });
    return {
      ok: true,
      updated: notes.updated,
      projectId: notes.projectId,
      documentId: notes.documentId,
      content: notes.content,
      sha256: notes.sha256,
      path: notes.path,
      relativePath: "PROJECT.md",
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function openProjectFolder(body) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  const projectRoot = projectFileWorkspace.target.projectRootPath;
  if (process.platform !== "darwin") {
    throw new HttpError(
      501,
      "PLATFORM_NOT_SUPPORTED",
      "Opening Finder is only supported on macOS.",
    );
  }
  await execFileAsync("open", [projectRoot]);
  return { ok: true, path: projectRoot };
}
async function readBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("object required");
    }
    return parsed;
  } catch {
    throw new HttpError(
      400,
      "INVALID_JSON",
      "Request body must be a JSON object.",
    );
  }
}

function originAllowed(origin) {
  if (!origin) return true;
  if (origin === "null" && process.env.HTML_AI_ALLOW_FILE_ORIGIN === "1") {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!originAllowed(origin)) {
    throw new HttpError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "Only localhost origins may call this bridge.",
    );
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-HTML-AI-Bridge-Token",
  );
}

function requireBridgeAuthorization(request) {
  if (!BRIDGE_AUTH_TOKEN) return;
  const suppliedHeader = request.headers["x-html-ai-bridge-token"];
  const suppliedToken =
    typeof suppliedHeader === "string"
      ? suppliedHeader
      : Array.isArray(suppliedHeader)
        ? suppliedHeader[0] ?? ""
        : "";
  const expectedDigest = Buffer.from(sha256Hex(BRIDGE_AUTH_TOKEN), "hex");
  const suppliedDigest = Buffer.from(sha256Hex(suppliedToken), "hex");
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "A valid workspace bridge token is required.",
    );
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendBinary(response, status, buffer, fileName) {
  const asciiName = safeAttachmentFileName(fileName).replace(/[^\x20-\x7e]/g, "_");
  response.writeHead(status, {
    "Content-Type": "application/octet-stream",
    "Content-Length": buffer.byteLength,
    "Content-Disposition": `inline; filename="${asciiName.replaceAll('"', "")}"`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(buffer);
}

function normalizeError(error) {
  if (error instanceof LifecycleError) {
    return {
      status: error.status ?? 422,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error.",
      },
    },
  };
}

function requiredSourcePath(value) {
  if (!value) {
    throw new HttpError(
      400,
      "SOURCE_PATH_REQUIRED",
      "sourcePath is required.",
    );
  }
  return value;
}

async function route(request, response) {
  applyCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  requireBridgeAuthorization(request);
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: SERVICE_NAME,
      host: HOST,
      port: PORT,
      workspace: WORKSPACE_ROOT,
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/workspace") {
    sendJson(
      response,
      200,
      await workspaceState(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/source") {
    sendJson(
      response,
      200,
      await sourceFile(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/source-preview") {
    sendJson(
      response,
      200,
      await sourcePreview(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/source-stat") {
    sendJson(
      response,
      200,
      await sourceStat(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/registered-projects") {
    sendJson(response, 200, await registeredProjectCatalog());
    return;
  }
  if (request.method === "GET" && url.pathname === "/registered-project/open") {
    sendJson(
      response,
      200,
      await registeredProjectOpen(url.searchParams.get("projectId")),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/managed-working-copy/reconcile") {
    const body = await readBody(request);
    sendJson(response, 200, await reconcileManagedWorkingCopy(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/project/ensure") {
    const body = await readBody(request);
    sendJson(response, 200, await ensureProject(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/conflict-candidate") {
    sendJson(
      response,
      200,
      await autosaveConflictCandidate(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/autosave") {
    const body = await readBody(request);
    sendJson(response, 200, await saveAutosave(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/source-history/action") {
    const body = await readBody(request);
    sendJson(response, 200, await runSourceHistoryAction(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/version") {
    throw new HttpError(
      410,
      "LOCAL_VERSIONING_REMOVED",
      "Manual save no longer creates a Version; use /autosave.",
    );
  }
  if (request.method === "POST" && url.pathname === "/draft") {
    const body = await readBody(request);
    sendJson(response, 200, await saveDraft(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/attachment") {
    const body = await readBody(request);
    sendJson(response, 201, await saveDraftAttachment(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/attachment") {
    const attachment = await readAttachment(
      requiredSourcePath(url.searchParams.get("sourcePath")),
      url.searchParams.get("relativePath"),
    );
    sendBinary(response, 200, attachment.buffer, attachment.fileName);
    return;
  }
  if (request.method === "POST" && url.pathname === "/attachment/delete") {
    const body = await readBody(request);
    sendJson(response, 200, await deleteDraftAttachment(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/request") {
    const body = await readBody(request);
    sendJson(response, 201, await createRequest(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/status") {
    const sourcePath = requiredSourcePath(url.searchParams.get("sourcePath"));
    const requestId = url.searchParams.get("requestId");
    if (!requestId) {
      throw new HttpError(
        400,
        "REQUEST_ID_REQUIRED",
        "requestId is required.",
      );
    }
    sendJson(
      response,
      200,
      await statusFor(
        sourcePath,
        requestId,
        url.searchParams.get("attemptId") ?? "attempt_001",
      ),
    );
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/ready-version/activate"
  ) {
    const body = await readBody(request);
    sendJson(response, 200, await activateReadyVersion(body));
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/history-version/continue"
  ) {
    const body = await readBody(request);
    sendJson(
      response,
      200,
      requireFound(await continueProjectFileHistoryVersion(body)),
    );
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/history-version/desktop-confirmed"
  ) {
    const body = await readBody(request);
    sendJson(
      response,
      200,
      requireFound(await confirmProjectFileHistoryVersion(body)),
    );
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/active-run/cancel"
  ) {
    const body = await readBody(request);
    sendJson(response, 200, await cancelActiveRun(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/conflict/resolve") {
    const body = await readBody(request);
    sendJson(response, 200, await resolveConflict(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/version-file") {
    sendJson(
      response,
      200,
      await versionFile(
        requiredSourcePath(url.searchParams.get("sourcePath")),
        url.searchParams.get("versionId"),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/ai-task") {
    sendJson(
      response,
      200,
      requireFound(await projectFileAiTask(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      )),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/project-file") {
    sendJson(
      response,
      200,
      await projectFileGet(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/file") {
    sendJson(
      response,
      200,
      await inspectProjectFile(
        requiredSourcePath(url.searchParams.get("sourcePath")),
        url.searchParams.get("path"),
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/project-file") {
    const body = await readBody(request);
    sendJson(response, 200, await projectFileUpdate(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/open-folder") {
    const body = await readBody(request);
    sendJson(response, 200, await openProjectFolder(body));
    return;
  }
  throw new HttpError(404, "NOT_FOUND", "Endpoint was not found.");
}

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    const normalized = normalizeError(error);
    if (!response.headersSent) {
      try {
        applyCors(request, response);
      } catch {
        // The normalized error is sufficient.
      }
      sendJson(response, normalized.status, normalized.body);
    } else {
      response.destroy();
    }
  });
});

server.on("error", (error) => {
  process.stderr.write(
    `${JSON.stringify({
      type: "fatal",
      error: {
        code: error?.code ?? "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Server failed.",
      },
    })}\n`,
  );
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      service: SERVICE_NAME,
      host: HOST,
      port: PORT,
      workspace: WORKSPACE_ROOT,
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    })}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

