#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  link,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertSchemaVersion,
  atomicWriteFile,
  atomicWriteJson,
  AUXILIARY_SCHEMA_VERSION,
  CANONICALIZATION_VERSION,
  COMPLETION_SCHEMA_VERSION,
  comparisonSha256,
  ensureDirectory,
  exists,
  FINALIZER_VERSION,
  findUnexpectedAttemptEntry,
  findUnexpectedAttemptOutputEntry,
  jsonText,
  LIFECYCLE_SCHEMA_VERSION,
  LifecycleError,
  MANAGED_META_NAMES,
  nowIso,
  projectDisplayName,
  projectDirectory,
  projectStorageDirectoryName,
  assertProjectStorageDirectoryName,
  readVersionedJson,
  requireCompleteHtml,
  sha256,
  sha256Hex,
  syncDirectory,
  validateUserSupplementArchive,
  withProjectFileLock,
} from "./lifecycle-core.mjs";
import {
  metaContentByName,
  parseHtmlSource,
} from "./html-source-parser.mjs";
import {
  rawStartTagAttributes,
} from "./scope-validator.mjs";
import {
  assessHtmlCandidate,
} from "./candidate-assessment.mjs";
import {
  decodeCandidateAssessmentRecord,
  decodeHistoricalCandidateAssessment,
} from "./candidate-assessment-decoder.mjs";
import {
  decodeDirectEditIdentity,
  DirectEditCompatibilityError,
} from "../shared/direct-edit-compatibility.mjs";
import {
  PRODUCT_MAX_BRIDGE_BODY_BYTES,
  PRODUCT_MAX_HTML_BYTES,
  isGeneratedWorkingCopyFileName,
  semanticVersionLabel,
  workingCopyFileName,
  workingCopyStem,
} from "./product-contract.mjs";
import { freezeLocalAttachment } from "./attachment-storage.mjs";
import {
  activeDraftSnapshot,
  applyDraftCommand,
} from "./draft-service.mjs";
import {
  applySourceHistoryCommand,
  prepareAutosaveSourceHistory,
  readSourceHistory,
  sourceHistoryResponse,
} from "./source-history-service.mjs";
import {
  commitSourceTransaction,
  recoverPendingSourceTransaction,
  sourceTransactionAuditEvent,
} from "./source-transaction-service.mjs";
import {
  classifySourceObservation,
  ProjectContextPolicyError,
  registeredCommandIdentity,
  registeredProjectRecord,
} from "./project-context-service.mjs";
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
const PROJECTS_ROOT = path.join(WORKSPACE_ROOT, "projects");
const REGISTRY_PATH = path.join(WORKSPACE_ROOT, "project-registry.json");
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
});
const FINALIZER_PATH = fileURLToPath(
  new URL("./finalize-attempt.mjs", import.meta.url),
);
const RECORD_SUPPLEMENT_PATH = fileURLToPath(
  new URL("./record-user-supplement.mjs", import.meta.url),
);
const MAX_BODY_BYTES = PRODUCT_MAX_BRIDGE_BODY_BYTES;
const MAX_FILE_BYTES = PRODUCT_MAX_HTML_BYTES;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_COMMENT = 10;
const MAX_REQUEST_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_EXECUTION_MODULE_TEXT_QUOTE_CHARS = 500;
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

class InjectedFailpointError extends Error {
  constructor(name) {
    super(`Injected lifecycle failpoint: ${name}`);
    this.name = "InjectedFailpointError";
    this.code = "INJECTED_FAILPOINT";
    this.status = 500;
  }
}

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(task) {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const projectQueues = new Map();
const registryQueue = new SerialQueue();
let initializationPromise = null;

function projectQueue(projectId) {
  if (!projectQueues.has(projectId)) {
    projectQueues.set(projectId, new SerialQueue());
  }
  return projectQueues.get(projectId);
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

function resolveAttachmentPath(context, relativePath, { draftOnly = false } = {}) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  const allowed = draftOnly
    ? /^draft\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+$/
    : /^(?:draft\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+|requests\/req_[A-Za-z0-9_-]+\/input\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+)$/;
  if (!allowed.test(normalized)) {
    throw new HttpError(422, "INVALID_ATTACHMENT_PATH", "Attachment path is invalid.");
  }
  const absolutePath = path.resolve(context.projectRoot, ...normalized.split("/"));
  const projectPrefix = `${path.resolve(context.projectRoot)}${path.sep}`;
  if (!absolutePath.startsWith(projectPrefix)) {
    throw new HttpError(422, "INVALID_ATTACHMENT_PATH", "Attachment path escapes the project.");
  }
  return { relativePath: normalized, absolutePath };
}

function sourceFingerprint(sourcePath) {
  return sha256(Buffer.from(path.normalize(sourcePath)));
}

function sourceFileIdentity(source) {
  const information = source?.information;
  if (!information) return null;
  return {
    dev: String(information.dev),
    ino: String(information.ino),
    birthtimeMs: String(information.birthtimeMs),
  };
}

function isSourceFileIdentity(value) {
  return Boolean(
    value
    && typeof value === "object"
    && typeof value.dev === "string"
    && typeof value.ino === "string"
    && typeof value.birthtimeMs === "string",
  );
}

function sameSourceFileIdentity(left, right) {
  return isSourceFileIdentity(left)
    && isSourceFileIdentity(right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs;
}

function sourceIdentityState(source) {
  return {
    fileIdentity: sourceFileIdentity(source),
    confirmedSourceSha256: source.sha256,
    observedLastModifiedAt: source.lastModifiedAt,
    observedByteLength: source.buffer.byteLength,
  };
}

function assignCurrentSourceIdentity(
  registry,
  { sourcePath, projectId, documentId, source, canonicalSourcePath = sourcePath },
) {
  const fingerprint = sourceFingerprint(sourcePath);
  const identity = sourceIdentityState(source);
  registry.sources[fingerprint] = {
    ...(registry.sources[fingerprint] ?? {}),
    sourcePath,
    canonicalSourcePath,
    role: sourcePath === canonicalSourcePath ? "current" : "alias",
    projectId,
    documentId,
    ...identity,
  };
  registry.projects[projectId] = {
    ...(registry.projects[projectId] ?? {}),
    sourcePath: canonicalSourcePath,
    sourceFingerprint: sourceFingerprint(canonicalSourcePath),
    documentId,
    ...identity,
  };
  registry.documents[documentId] = {
    ...(registry.documents[documentId] ?? {}),
    projectId,
    sourcePath: canonicalSourcePath,
    sourceFingerprint: sourceFingerprint(canonicalSourcePath),
    ...identity,
  };
  return registry.sources[fingerprint];
}

async function canonicalizeProjectSourceRecords(
  registry,
  projectId,
  canonicalSourcePath,
) {
  const retained = [];
  for (const [fingerprint, record] of Object.entries(registry.sources)) {
    if (record?.projectId !== projectId) continue;
    delete registry.sources[fingerprint];
    const sourcePath = await canonicalExistingSourcePath(record.sourcePath);
    retained.push({
      ...record,
      sourcePath,
      canonicalSourcePath,
      role: sourcePath === canonicalSourcePath ? "current" : "alias",
    });
  }
  for (const record of retained) {
    const fingerprint = sourceFingerprint(record.sourcePath);
    const collision = registry.sources[fingerprint];
    if (collision && collision.projectId !== projectId) {
      throw new HttpError(
        409,
        "ACTIVE_SOURCE_PATH_COLLISION",
        "A canonical source path belongs to another project.",
      );
    }
    registry.sources[fingerprint] = {
      ...(collision ?? {}),
      ...record,
    };
  }
}

function randomStableId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function assertLifecycleSchemaVersion(value, label) {
  return assertSchemaVersion(value, LIFECYCLE_SCHEMA_VERSION, label);
}

function assertAuxiliarySchemaVersion(value, label) {
  return assertSchemaVersion(value, AUXILIARY_SCHEMA_VERSION, label);
}

function readLifecycleJson(filePath, label) {
  return readVersionedJson(
    filePath,
    label,
    LIFECYCLE_SCHEMA_VERSION,
  );
}

function readAuxiliaryJson(filePath, label) {
  return readVersionedJson(
    filePath,
    label,
    AUXILIARY_SCHEMA_VERSION,
  );
}

function documentIdFromHtml(html) {
  const value = metaContentByName(html, "html-ai-document-id");
  return /^doc_[a-f0-9]{16,64}$/.test(value ?? "") ? value : null;
}

function assertCanonicalManagedMeta(
  html,
  activeRun,
  outputRelativePath = "output/index.html",
) {
  const expected = new Map([
    ["html-ai-document-id", activeRun.documentId],
    ["html-ai-version-id", activeRun.candidateVersionId],
    ["html-ai-version-label", activeRun.candidateVersionLabel],
    ["html-ai-based-on-version-id", activeRun.basedOnVersionId],
    ["html-ai-request-id", activeRun.requestId],
  ]);
  const occurrences = new Map(
    MANAGED_META_NAMES.map((name) => [name, []]),
  );
  const parsed = parseHtmlSource(html);
  for (const token of parsed.elements) {
    if (token.name !== "meta") continue;
    const attributes = rawStartTagAttributes(
      parsed.source,
      token.node?.sourceCodeLocation?.startTag,
    );
    const names = attributes.filter(({ name }) => name === "name");
    const contents = attributes.filter(({ name }) => name === "content");
    const managedNames = names
      .map(({ value }) => value.toLowerCase())
      .filter((name) => expected.has(name));
    if (managedNames.length === 0) continue;
    const canonical =
      names.length === 1
      && contents.length === 1
      && attributes.length === 2
      && token.node?.parentNode?.tagName === "head";
    for (const name of managedNames) {
      occurrences.get(name).push({
        canonical,
        content: contents[0]?.value ?? null,
      });
    }
  }
  const problems = [];
  for (const [name, value] of expected) {
    const matches = occurrences.get(name);
    if (
      matches.length !== 1
      || matches[0].canonical !== true
      || matches[0].content !== value
    ) {
      problems.push({
        name,
        expected: value,
        occurrences: matches.length,
        actual: matches.map((match) => match.content),
      });
    }
  }
  if (problems.length > 0) {
    throw new HttpError(
      422,
      "OUTPUT_MANAGED_META_MISMATCH",
      `${outputRelativePath} must contain exactly one canonical lifecycle meta for every active-run identity field.`,
      { problems },
    );
  }
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

async function canonicalExistingSourcePath(value) {
  const normalized = normalizeSourcePath(value);
  try {
    const canonicalParent = await realpath(path.dirname(normalized));
    return path.join(canonicalParent, path.basename(normalized));
  } catch (error) {
    if (error?.code === "ENOENT") return normalized;
    throw error;
  }
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

const COMPLETION_FIELD_NAMES = Object.freeze([
  "schemaVersion",
  "finalizerVersion",
  "status",
  "projectId",
  "documentId",
  "requestId",
  "attemptId",
  "basedOnVersionId",
  "previousVersionId",
  "candidateVersionId",
  "candidateVersionOrdinal",
  "candidateVersionLabel",
  "baseSnapshotSha256",
  "inputManifestSha256",
  "outputRelativePath",
  "outputSha256",
  "baseComparisonSha256",
  "outputComparisonSha256",
  "canonicalizationVersion",
  "completedAt",
]);

const COMPLETION_STRING_PATTERNS = Object.freeze({
  projectId: /^project_[A-Za-z0-9_-]+$/,
  documentId: /^doc_[A-Za-z0-9_-]+$/,
  requestId: /^req_[A-Za-z0-9_-]+$/,
  attemptId: /^attempt_[0-9]{3}$/,
  basedOnVersionId: /^ver_[0-9]{4,}$/,
  previousVersionId: /^ver_[0-9]{4,}$/,
  candidateVersionId: /^ver_[0-9]{4,}$/,
  candidateVersionLabel: /^V[1-9][0-9]*$/,
  baseSnapshotSha256: /^sha256:[a-f0-9]{64}$/,
  inputManifestSha256: /^sha256:[a-f0-9]{64}$/,
  outputSha256: /^sha256:[a-f0-9]{64}$/,
  baseComparisonSha256: /^sha256:[a-f0-9]{64}$/,
  outputComparisonSha256: /^sha256:[a-f0-9]{64}$/,
});

function completionSchemaError(message, details) {
  throw new HttpError(
    422,
    "COMPLETION_SCHEMA_INVALID",
    message,
    details,
  );
}

function isRfc3339DateTime(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);
  const offsetHour = match[10] === undefined
    ? 0
    : Number.parseInt(match[10], 10);
  const offsetMinute = match[11] === undefined
    ? 0
    : Number.parseInt(match[11], 10);
  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 60
    && offsetHour <= 23
    && offsetMinute <= 59
  );
}

function validateCompletionSchema(completion) {
  if (
    completion === null
    || typeof completion !== "object"
    || Array.isArray(completion)
  ) {
    completionSchemaError(
      "completion.json must be a JSON object.",
      { keyword: "type", expected: "object" },
    );
  }
  const allowedFields = new Set(COMPLETION_FIELD_NAMES);
  const unknownFields = Object.keys(completion).filter(
    (key) => !allowedFields.has(key),
  );
  if (unknownFields.length > 0) {
    completionSchemaError(
      "completion.json contains unknown fields.",
      { keyword: "additionalProperties", unknownFields },
    );
  }
  const missingFields = COMPLETION_FIELD_NAMES.filter(
    (key) => !Object.hasOwn(completion, key),
  );
  if (missingFields.length > 0) {
    completionSchemaError(
      "completion.json is missing required fields.",
      { keyword: "required", missingFields },
    );
  }
  for (const [key, pattern] of Object.entries(COMPLETION_STRING_PATTERNS)) {
    if (typeof completion[key] !== "string" || !pattern.test(completion[key])) {
      completionSchemaError(
        `completion.json ${key} does not match its required format.`,
        { keyword: "pattern", field: key },
      );
    }
  }
  const constants = {
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    finalizerVersion: FINALIZER_VERSION,
    status: "completed",
    canonicalizationVersion: CANONICALIZATION_VERSION,
  };
  for (const [key, expected] of Object.entries(constants)) {
    if (completion[key] !== expected) {
      completionSchemaError(
        `completion.json ${key} must equal ${JSON.stringify(expected)}.`,
        { keyword: "const", field: key, expected, actual: completion[key] },
      );
    }
  }
  if (!isAttemptOutputRelativePath(completion.outputRelativePath)) {
    completionSchemaError(
      "completion.json outputRelativePath does not match a supported Attempt output name.",
      { keyword: "pattern", field: "outputRelativePath" },
    );
  }
  if (
    !Number.isInteger(completion.candidateVersionOrdinal)
    || completion.candidateVersionOrdinal < 2
  ) {
    completionSchemaError(
      "completion.json candidateVersionOrdinal must be an integer of at least 2.",
      {
        keyword: Number.isInteger(completion.candidateVersionOrdinal)
          ? "minimum"
          : "type",
        field: "candidateVersionOrdinal",
      },
    );
  }
  if (!isRfc3339DateTime(completion.completedAt)) {
    completionSchemaError(
      "completion.json completedAt must be a valid RFC 3339 date-time.",
      { keyword: "format", field: "completedAt", format: "date-time" },
    );
  }
}

function versionOrdinal(versionId) {
  const match = /^ver_(\d+)$/.exec(versionId ?? "");
  return match ? Number.parseInt(match[1], 10) : 0;
}

function userVersionLabel(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new HttpError(
      500,
      "INVALID_VERSION_ORDINAL",
      "Version ordinal must be a positive integer.",
    );
  }
  return `版本 ${ordinal}`;
}

function workingCopyDescriptor(projectName, ordinal) {
  const versionLabel = semanticVersionLabel(ordinal);
  const stem = workingCopyStem(projectName, versionLabel);
  const fileName = workingCopyFileName(stem, versionLabel);
  return {
    versionLabel,
    stem,
    fileName,
    relativePath: `working/${fileName}`,
  };
}

function attemptOutputDescriptor(projectName, ordinal) {
  const workingCopy = workingCopyDescriptor(projectName, ordinal);
  return {
    fileName: workingCopy.fileName,
    relativePath: `output/${workingCopy.fileName}`,
  };
}

function isAttemptOutputRelativePath(value) {
  if (value === "output/index.html") return true;
  if (typeof value !== "string" || !value.startsWith("output/")) return false;
  return isGeneratedWorkingCopyFileName(value.slice("output/".length));
}

function outputPathIdentityFromTransaction(transaction) {
  const attemptRelativePath =
    `requests/${transaction.requestId}/attempts/${transaction.attemptId}`;
  const outputRelativePath = transaction.outputRelativePath
    ?? `${attemptRelativePath}/output/index.html`;
  const expectedPrefix = `${attemptRelativePath}/`;
  if (
    typeof outputRelativePath !== "string"
    || !outputRelativePath.startsWith(expectedPrefix)
  ) {
    throw new HttpError(
      409,
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The transaction output path does not match its Request and Attempt.",
      {
        expectedPrefix,
        actual: outputRelativePath,
      },
    );
  }
  const attemptOutputRelativePath = outputRelativePath.slice(
    expectedPrefix.length,
  );
  if (!isAttemptOutputRelativePath(attemptOutputRelativePath)) {
    throw new HttpError(
      409,
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The transaction output path is not a supported Attempt output name.",
      {
        actual: outputRelativePath,
      },
    );
  }
  return { outputRelativePath, attemptOutputRelativePath };
}

async function outputRelativePathForActiveRun(context, activeRun, changeRequest) {
  const outputRelativePath = changeRequest?.finalization?.outputRelativePath;
  if (!isAttemptOutputRelativePath(outputRelativePath)) {
    throw new HttpError(
      422,
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The frozen Request declares an invalid Attempt output path.",
    );
  }
  const expectedActiveRunPath =
    `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/${outputRelativePath}`;
  if (activeRun.outputRelativePath !== expectedActiveRunPath) {
    throw new HttpError(
      422,
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The active run output path does not match the frozen Request.",
      {
        expected: expectedActiveRunPath,
        actual: activeRun.outputRelativePath,
      },
    );
  }
  // Existing frozen Attempts retain their historic staging filename. Newly
  // submitted Requests always use the PageRoot-computed original-name + V1.x
  // filename and cannot ask the AI to choose another name.
  if (outputRelativePath === "output/index.html") return outputRelativePath;
  const project = await readProject(context);
  const expectedOutputRelativePath = attemptOutputDescriptor(
    project.displayName,
    activeRun.candidateVersionOrdinal,
  ).relativePath;
  if (outputRelativePath !== expectedOutputRelativePath) {
    throw new HttpError(
      422,
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The frozen Request output path does not match its user filename and Version.",
      {
        expected: expectedOutputRelativePath,
        actual: outputRelativePath,
      },
    );
  }
  return outputRelativePath;
}

function paddedId(prefix, ordinal, width) {
  return `${prefix}${String(ordinal).padStart(width, "0")}`;
}

async function listIds(root, pattern) {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.isSymbolicLink() && pattern.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

async function nextVersionIdentity(projectRoot) {
  const ids = await listIds(
    path.join(projectRoot, "versions"),
    /^ver_\d{4,}$/,
  );
  const ordinal =
    ids.reduce(
      (maximum, id) => Math.max(maximum, versionOrdinal(id)),
      0,
    ) + 1;
  return {
    versionId: paddedId("ver_", ordinal, 4),
    versionOrdinal: ordinal,
    versionLabel: `V${ordinal}`,
  };
}

async function nextRequestId(projectRoot) {
  const ids = await listIds(
    path.join(projectRoot, "requests"),
    /^req_\d{4,}$/,
  );
  const ordinal =
    ids.reduce((maximum, id) => {
      const value = Number.parseInt(id.slice(4), 10);
      return Math.max(maximum, Number.isFinite(value) ? value : 0);
    }, 0) + 1;
  return paddedId("req_", ordinal, 4);
}

async function readSourceFile(sourcePath) {
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
  requireCompleteHtml(html, "source HTML");
  return {
    buffer,
    html,
    sha256: sha256(buffer),
    information,
    lastModifiedAt: information.mtime.toISOString(),
  };
}

function projectFileHttpError(cause) {
  if (!(cause instanceof ProjectFileRepositoryError)) return cause;
  const code = String(cause.code || "PROJECT_FILE_ERROR");
  const status = new Set([
    "SOURCE_NOT_FOUND",
    "PROJECT_ROOT_NOT_FOUND",
    "PROJECT_CONTROL_NOT_FOUND",
    "PROJECT_FILE_NOT_FOUND",
    "PROJECTS_ROOT_NOT_FOUND",
    "CANDIDATE_NOT_FOUND",
    "WORKING_COPY_NOT_FOUND",
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
      "WORKING_COPY_CONFLICT",
      "AMBIGUOUS_SOURCE_FILE_IDENTITY",
      "ACTIVE_REQUEST_EXISTS",
      "STALE_CANDIDATE",
      "CANDIDATE_SOURCE_CHANGED",
      "CANDIDATE_NOT_PENDING_REVIEW",
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
      "IMPORT_INTENT_NOT_FOUND",
      "REGISTERED_PROJECT_RACE",
    ]).has(code)
      ? 409
      : new Set([
        "UNSAFE_FILE",
        "UNSAFE_DIRECTORY",
        "UNSUPPORTED_HTML_EXTENSION",
        "UNSUPPORTED_HTML_ENCODING",
        "UNSUPPORTED_RELATIVE_RESOURCE",
        "INCOMPLETE_HTML",
        "PATH_ESCAPES_PROJECT",
        "INVALID_RELATIVE_PATH",
        "INVALID_ID",
        "INVALID_FILE_STEM",
        "INVALID_CANDIDATE_ID",
        "CANDIDATE_UNUSABLE",
        "CANDIDATE_VALIDATION_INVALID",
        "INVALID_REQUEST_ID",
        "INVALID_ATTEMPT_ID",
        "INVALID_REGISTRY",
        "UNSUPPORTED_REGISTRY_SCHEMA",
        "UNREGISTERED_PROJECT_ROOT",
      ]).has(code)
        ? 422
        : 500;
  return new HttpError(status, code, cause.message, cause.details);
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
  return workspace.manifest.versions.map((version) => ({
    schemaVersion: "4.0.0",
    ...version,
    sourceType: version.sourceCandidateId ? "internal-ai" : "initial",
    versionLabel: `V${version.ordinal}`,
    generatedAt: version.createdAt,
    requestId: version.sourceRequestId,
    attemptId: null,
    committed: true,
  }));
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
  const request = workspace.activeRequest;
  if (!request || typeof request !== "object") return null;
  const candidate = workspace.activeCandidate;
  const candidateReady = request.status === "candidate-ready" && candidate;
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
    status: candidateReady ? "ready-to-open" : "processing",
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
    } : {}),
  };
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
    recentRunOutcome: null,
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
      activeRun: run,
      candidateDisplayVersionLabel: `版本 ${durable.proposedVersionOrdinal}`,
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
    return {
      ok: true,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      versionId: file.version.versionId,
      content: file.content,
      sha256: file.sha256,
      contentSha256: file.sha256,
      path: file.path,
      relativePath: file.kind === "candidate"
        ? file.candidate.outputRelativePath
        : file.version.snapshotRelativePath,
      readOnly: true,
      ...(file.kind === "candidate" ? { candidate: file.candidate } : {}),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

function workingCopyIdentity(context, transaction) {
  const versionLabel = semanticVersionLabel(
    transaction.candidateVersionOrdinal,
  );
  const relativePath = transaction.workingCopyStem
    ? `working/${workingCopyFileName(transaction.workingCopyStem, versionLabel)}`
    : `working/${versionLabel}.html`;
  if (
    transaction.paths?.activeWorkingCopyRelativePath
    && transaction.paths.activeWorkingCopyRelativePath !== relativePath
  ) {
    throw new HttpError(
      409,
      "WORKING_COPY_PATH_MISMATCH",
      "The transaction working-copy path does not match its Version identity.",
      {
        expected: relativePath,
        actual: transaction.paths.activeWorkingCopyRelativePath,
      },
    );
  }
  const absolutePath = path.resolve(
    context.projectRoot,
    ...relativePath.split("/"),
  );
  const projectPrefix = `${path.resolve(context.projectRoot)}${path.sep}`;
  if (!absolutePath.startsWith(projectPrefix)) {
    throw new HttpError(
      409,
      "WORKING_COPY_PATH_INVALID",
      "The transaction working-copy path escapes the project.",
    );
  }
  return { versionLabel, relativePath, absolutePath };
}

async function ensureWorkingCopyRaw(context, transaction, content) {
  const identity = workingCopyIdentity(context, transaction);
  const expectedSha256 = transaction.candidateContentSha256;
  const existing = await exists(identity.absolutePath)
    ? await readSourceFile(identity.absolutePath)
    : null;
  if (existing) {
    if (existing.sha256 !== expectedSha256) {
      throw new HttpError(
        409,
        "WORKING_COPY_COLLISION",
        "The next semantic Version file already exists with different content.",
        {
          path: identity.absolutePath,
          expectedSha256,
          actualSha256: existing.sha256,
        },
      );
    }
    return { ...identity, source: existing, created: false };
  }

  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (sha256(buffer) !== expectedSha256) {
    throw new HttpError(
      409,
      "WORKING_COPY_HASH_MISMATCH",
      "The prepared AI output does not match the transaction.",
    );
  }
  requireCompleteHtml(buffer.toString("utf8"), "AI working copy");
  const directory = path.dirname(identity.absolutePath);
  await ensureDirectory(directory);
  const temporary = path.join(
    directory,
    `.pageroot-working-${process.pid}-${randomUUID()}.tmp`,
  );
  await atomicWriteFile(temporary, buffer);
  let created = false;
  try {
    try {
      // A hard-link publication makes the complete temporary file visible at
      // its final semantic name without ever replacing an existing Version.
      await link(temporary, identity.absolutePath);
      created = true;
      await syncDirectory(directory);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  const source = await readSourceFile(identity.absolutePath);
  if (source.sha256 !== expectedSha256) {
    throw new HttpError(
      409,
      "WORKING_COPY_COLLISION",
      "The semantic Version file does not match the committed AI output.",
      {
        path: identity.absolutePath,
        expectedSha256,
        actualSha256: source.sha256,
      },
    );
  }
  return { ...identity, source, created };
}

async function removeUnactivatedWorkingCopyRaw(context, transaction) {
  const identity = workingCopyIdentity(context, transaction);
  if (!(await exists(identity.absolutePath))) return;
  const project = await readLifecycleJson(
    path.join(context.projectRoot, "project.json"),
    "project.json",
  );
  if (project.sourcePath === identity.absolutePath) return;
  const candidate = await readSourceFile(identity.absolutePath);
  if (candidate.sha256 !== transaction.candidateContentSha256) {
    throw new HttpError(
      409,
      "WORKING_COPY_COLLISION",
      "An uncommitted semantic Version file contains unrelated content.",
    );
  }
  await rm(identity.absolutePath, { force: true });
  await syncDirectory(path.dirname(identity.absolutePath));
}

function emptyRegistry() {
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    updatedAt: nowIso(),
    sources: {},
    projects: {},
    documents: {},
  };
}

function hasProjectStorageMetadata(record) {
  return Boolean(
    record
    && typeof record === "object"
    && !Array.isArray(record)
    && typeof record.displayName === "string"
    && record.displayName.trim().length > 0
    && record.displayName.length <= 300
    && typeof record.createdAt === "string"
    && !Number.isNaN(Date.parse(record.createdAt))
    && typeof record.storageDirectoryName === "string",
  );
}

function hasAnyProjectStorageMetadata(record) {
  return Boolean(
    record
    && typeof record === "object"
    && (
      Object.hasOwn(record, "displayName")
      || Object.hasOwn(record, "createdAt")
      || Object.hasOwn(record, "storageDirectoryName")
    ),
  );
}

function legacyProjectMigrationError(projectId, reason) {
  return new HttpError(
    409,
    "WORKSPACE_SCHEMA_INVALID",
    `project-registry.json project ${projectId} cannot be migrated: ${reason}`,
  );
}

async function migrateLegacyProjectStorageMetadata(registry) {
  const migrations = [];
  for (const [projectId, record] of Object.entries(registry.projects)) {
    if (hasProjectStorageMetadata(record)) continue;
    if (hasAnyProjectStorageMetadata(record)) {
      throw legacyProjectMigrationError(
        projectId,
        "readable storage metadata is incomplete",
      );
    }
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || typeof record.documentId !== "string"
      || typeof record.sourcePath !== "string"
    ) {
      throw legacyProjectMigrationError(
        projectId,
        "legacy source identity is incomplete",
      );
    }

    const projectRoot = projectDirectory(
      WORKSPACE_ROOT,
      projectId,
      projectId,
    );
    let project;
    let initialVersion;
    try {
      [project, initialVersion] = await Promise.all([
        readLifecycleJson(
          path.join(projectRoot, "project.json"),
          "project.json",
        ),
        readLifecycleJson(
          path.join(projectRoot, "versions", "ver_0001", "version.json"),
          "ver_0001/version.json",
        ),
      ]);
    } catch {
      throw legacyProjectMigrationError(
        projectId,
        "legacy project records are missing or invalid",
      );
    }
    if (
      project.projectId !== projectId
      || project.documentId !== record.documentId
      || project.sourcePath !== record.sourcePath
      || initialVersion.projectId !== projectId
      || initialVersion.documentId !== record.documentId
      || initialVersion.versionId !== "ver_0001"
      || initialVersion.sourceType !== "initial"
      || typeof initialVersion.generatedAt !== "string"
      || Number.isNaN(Date.parse(initialVersion.generatedAt))
    ) {
      throw legacyProjectMigrationError(
        projectId,
        "legacy project identity does not match its initial version",
      );
    }

    const projectHasMetadata = hasProjectStorageMetadata(project);
    if (hasAnyProjectStorageMetadata(project) && !projectHasMetadata) {
      throw legacyProjectMigrationError(
        projectId,
        "project.json readable storage metadata is incomplete",
      );
    }
    const metadata = projectHasMetadata
      ? {
          displayName: project.displayName,
          createdAt: project.createdAt,
          storageDirectoryName: project.storageDirectoryName,
        }
      : {
          displayName: projectDisplayName(record.sourcePath),
          createdAt: initialVersion.generatedAt,
          storageDirectoryName: projectId,
        };
    if (metadata.storageDirectoryName !== projectId) {
      throw legacyProjectMigrationError(
        projectId,
        "legacy project directory identity changed unexpectedly",
      );
    }
    migrations.push({
      projectId,
      projectRoot,
      project,
      projectHasMetadata,
      metadata,
    });
  }

  if (migrations.length === 0) return false;
  for (const migration of migrations) {
    if (!migration.projectHasMetadata) {
      await atomicWriteJson(
        path.join(migration.projectRoot, "project.json"),
        {
          ...migration.project,
          ...migration.metadata,
        },
      );
    }
    registry.projects[migration.projectId] = {
      ...registry.projects[migration.projectId],
      ...migration.metadata,
    };
  }
  await writeRegistry(registry);
  return true;
}

async function readRegistry() {
  if (!(await exists(REGISTRY_PATH))) return emptyRegistry();
  const registry = await readLifecycleJson(
    REGISTRY_PATH,
    "project-registry.json",
  );
  for (const field of ["sources", "projects", "documents"]) {
    if (
      !registry[field]
      || typeof registry[field] !== "object"
      || Array.isArray(registry[field])
    ) {
      throw new HttpError(
        409,
        "WORKSPACE_SCHEMA_INVALID",
        `project-registry.json ${field} must be an object.`,
      );
    }
  }
  await migrateLegacyProjectStorageMetadata(registry);
  for (const [projectId, record] of Object.entries(registry.projects)) {
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || typeof record.displayName !== "string"
      || record.displayName.trim().length === 0
      || record.displayName.length > 300
      || typeof record.createdAt !== "string"
      || Number.isNaN(Date.parse(record.createdAt))
    ) {
      throw new HttpError(
        409,
        "WORKSPACE_SCHEMA_INVALID",
        `project-registry.json project ${projectId} metadata is invalid.`,
      );
    }
    try {
      assertProjectStorageDirectoryName(
        record.storageDirectoryName,
        projectId,
      );
    } catch {
      throw new HttpError(
        409,
        "WORKSPACE_SCHEMA_INVALID",
        `project-registry.json project ${projectId} storage directory is invalid.`,
      );
    }
  }
  return registry;
}

async function writeRegistry(registry) {
  registry.schemaVersion = LIFECYCLE_SCHEMA_VERSION;
  registry.updatedAt = nowIso();
  await atomicWriteJson(REGISTRY_PATH, registry);
}

function projectRootFromRegistryRecord(projectId, record) {
  return projectDirectory(
    WORKSPACE_ROOT,
    record?.storageDirectoryName,
    projectId,
  );
}

function projectContextHttpError(error) {
  if (!(error instanceof ProjectContextPolicyError)) return error;
  return new HttpError(
    error.status,
    error.code,
    error.message,
    error.details,
  );
}

async function readRegisteredObservationState(registry, record) {
  const projectRoot = projectRootFromRegistryRecord(
    record.projectId,
    registry.projects[record.projectId],
  );
  const [project, runtime] = await Promise.all([
    readLifecycleJson(
      path.join(projectRoot, "project.json"),
      "project.json",
    ),
    readLifecycleJson(
      path.join(projectRoot, "runtime-state.json"),
      "runtime-state.json",
    ),
  ]);
  return { project, runtime };
}

async function availableProjectStorageDirectory({
  displayName,
  createdAt,
  projectId,
  registry,
}) {
  const registeredDirectoryNames = new Set(
    Object.values(registry.projects)
      .map((record) => record?.storageDirectoryName)
      .filter((value) => typeof value === "string"),
  );
  for (const suffixLength of [8, 12, 16, 24, 32]) {
    const storageDirectoryName = projectStorageDirectoryName({
      displayName,
      createdAt,
      projectId,
      suffixLength,
    });
    const projectRoot = projectDirectory(
      WORKSPACE_ROOT,
      storageDirectoryName,
      projectId,
    );
    if (
      !registeredDirectoryNames.has(storageDirectoryName)
      && !(await exists(projectRoot))
    ) {
      return { storageDirectoryName, projectRoot };
    }
  }
  throw new HttpError(
    409,
    "PROJECT_STORAGE_COLLISION",
    "A unique readable project directory could not be allocated.",
  );
}

async function syncCurrentSourceIdentity(context, source) {
  await registryQueue.run(() =>
    withProjectFileLock(WORKSPACE_ROOT, async () => {
      const registry = await readRegistry();
      const fingerprint = sourceFingerprint(context.sourcePath);
      const collision = registry.sources[fingerprint];
      if (collision && collision.projectId !== context.projectId) {
        throw new HttpError(
          409,
          "ACTIVE_SOURCE_PATH_COLLISION",
          "The source path belongs to another project.",
        );
      }
      assignCurrentSourceIdentity(registry, {
        sourcePath: context.sourcePath,
        projectId: context.projectId,
        documentId: context.documentId,
        source,
      });
      await writeRegistry(registry);
    })
  );
}

async function activateProjectSourceRaw(
  context,
  project,
  activeSourcePath,
) {
  const normalizedActivePath = await canonicalExistingSourcePath(activeSourcePath);
  const activeFingerprint = sourceFingerprint(normalizedActivePath);
  const activeSource = await readSourceFile(normalizedActivePath);
  project.sourcePath = normalizedActivePath;
  await writeProject(context, project);

  await registryQueue.run(() =>
    withProjectFileLock(WORKSPACE_ROOT, async () => {
      const registry = await readRegistry();
      const collision = registry.sources[activeFingerprint];
      if (collision && collision.projectId !== context.projectId) {
        throw new HttpError(
          409,
          "ACTIVE_SOURCE_PATH_COLLISION",
          "The generated working-copy path belongs to another project.",
        );
      }
      await canonicalizeProjectSourceRecords(
        registry,
        context.projectId,
        normalizedActivePath,
      );
      assignCurrentSourceIdentity(registry, {
        sourcePath: normalizedActivePath,
        canonicalSourcePath: normalizedActivePath,
        projectId: context.projectId,
        documentId: context.documentId,
        source: activeSource,
      });
      await writeRegistry(registry);
    })
  );
  context.sourcePath = normalizedActivePath;
}

function defaultProjectRules() {
  return "";
}

function draftArtifactRecord({
  draftRevision = 0,
  updatedAt,
  comments = [],
  changeEvents = [],
  deletedCommentIds = [],
  appliedOperationIds = [],
} = {}) {
  return {
    schemaVersion: AUXILIARY_SCHEMA_VERSION,
    draftRevision,
    updatedAt: updatedAt ?? nowIso(),
    comments,
    editEvents: changeEvents,
    deletedCommentIds,
    appliedOperationIds,
  };
}

function emptyRuntime(
  projectId,
  documentId,
  sourceSha256,
  latestVersionId = "ver_0001",
) {
  const timestamp = nowIso();
  const emptyDraftText = jsonText(draftArtifactRecord({
    draftRevision: 0,
    updatedAt: timestamp,
  }));
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId,
    documentId,
    lifecycleState: "editing",
    projectLocked: false,
    editRevision: 0,
    lastPersistedRevision: 0,
    freezeCutoffRevision: null,
    autosave: {
      status: "updated",
      expectedSourceSha256: sourceSha256,
      lastPersistedAt: timestamp,
      recoveryLogRelativePath: "recovery/autosave-log.json",
    },
    pendingWrite: null,
    pendingSubmission: null,
    view: {
      viewMode: "current",
      latestVersionId,
      currentBasedOnVersionId: latestVersionId,
      currentExactVersionId: latestVersionId,
      viewingVersionId: null,
      renderedContentSha256: sourceSha256,
    },
    activeRun: null,
    activeTransaction: null,
    draft: {
      annotationsRelativePath: "draft/annotations.json",
      annotationsSha256: sha256(emptyDraftText),
      commentIds: [],
      editEventIds: [],
      draftRevision: 0,
      updatedAt: timestamp,
    },
    updatedAt: timestamp,
  };
}

async function writeRuntime(projectRoot, runtime) {
  const timestamp = nowIso();
  const lifecycleState = runtime.lifecycleState;
  const locked = !["editing", "ready"].includes(lifecycleState);
  const draft = runtime.draft ?? {};
  const activeRun = runtime.activeRun
    ? {
        requestId: runtime.activeRun.requestId,
        attemptId: runtime.activeRun.attemptId,
        basedOnVersionId: runtime.activeRun.basedOnVersionId,
        previousVersionId: runtime.activeRun.previousVersionId,
        candidateVersionId: runtime.activeRun.candidateVersionId,
        candidateVersionOrdinal: runtime.activeRun.candidateVersionOrdinal,
        candidateVersionLabel: runtime.activeRun.candidateVersionLabel,
        baseSnapshotSha256: runtime.activeRun.baseSnapshotSha256,
        submittedAt:
          runtime.activeRun.submittedAt
          ?? runtime.activeRun.createdAt
          ?? timestamp,
        requestRelativePath:
          runtime.activeRun.requestRelativePath
          ?? `requests/${runtime.activeRun.requestId}`,
        attemptRelativePath:
          runtime.activeRun.attemptRelativePath
          ?? `requests/${runtime.activeRun.requestId}/attempts/${runtime.activeRun.attemptId}`,
        outputRelativePath:
          runtime.activeRun.outputRelativePath
          ?? `requests/${runtime.activeRun.requestId}/attempts/${runtime.activeRun.attemptId}/output/index.html`,
        completionRelativePath:
          runtime.activeRun.completionRelativePath
          ?? `requests/${runtime.activeRun.requestId}/attempts/${runtime.activeRun.attemptId}/completion.json`,
        frozenAnnotationsRelativePath:
          runtime.activeRun.frozenAnnotationsRelativePath
          ?? `requests/${runtime.activeRun.requestId}/input/annotations/records.json`,
        frozenAnnotationsSha256: runtime.activeRun.frozenAnnotationsSha256,
        ...(runtime.activeRun.inputManifestSha256
          ? { inputManifestSha256: runtime.activeRun.inputManifestSha256 }
          : {}),
        frozenCommentIds:
          runtime.activeRun.frozenCommentIds
          ?? (runtime.activeRun.frozenComments ?? [])
            .map((item) => item.commentId)
            .filter(Boolean),
        frozenEditEventIds:
          runtime.activeRun.frozenEditEventIds
          ?? (runtime.activeRun.frozenChangeEvents ?? [])
            .map((item) => item.eventId)
            .filter(Boolean),
      }
    : null;
  const pendingSubmission = lifecycleState === "submitting"
    ? {
        requestId:
          runtime.pendingSubmission?.requestId
          ?? runtime.activeRun?.requestId,
        attemptId:
          runtime.pendingSubmission?.attemptId
          ?? runtime.activeRun?.attemptId,
        basedOnVersionId:
          runtime.pendingSubmission?.basedOnVersionId
          ?? runtime.activeRun?.basedOnVersionId,
        previousVersionId:
          runtime.pendingSubmission?.previousVersionId
          ?? runtime.activeRun?.previousVersionId,
        candidateVersionId:
          runtime.pendingSubmission?.candidateVersionId
          ?? runtime.activeRun?.candidateVersionId,
        candidateVersionOrdinal:
          runtime.pendingSubmission?.candidateVersionOrdinal
          ?? runtime.activeRun?.candidateVersionOrdinal,
        candidateVersionLabel:
          runtime.pendingSubmission?.candidateVersionLabel
          ?? runtime.activeRun?.candidateVersionLabel,
        baseSnapshotSha256:
          runtime.pendingSubmission?.baseSnapshotSha256
          ?? runtime.activeRun?.baseSnapshotSha256,
        freezeCutoffRevision:
          runtime.pendingSubmission?.freezeCutoffRevision
          ?? runtime.freezeCutoffRevision
          ?? runtime.activeRun?.freezeCutoffRevision,
        lockedAt:
          runtime.pendingSubmission?.lockedAt
          ?? runtime.activeRun?.submittedAt
          ?? runtime.activeRun?.createdAt
          ?? timestamp,
      }
    : null;
  const transactionId =
    runtime.activeTransaction?.transactionId
    ?? runtime.transactionId
    ?? runtime.recovery?.transactionId
    ?? runtime.conflict?.transactionId
    ?? null;
  const activeTransaction =
    transactionId
    && (
      lifecycleState === "committing"
      || lifecycleState === "recovering-transaction"
      || (
        lifecycleState === "awaiting-conflict-resolution"
        && runtime.conflict?.type === "ai-source"
      )
    )
      ? {
          transactionId,
          transactionRelativePath:
            `transactions/${transactionId}/transaction.json`,
        }
      : null;
  const autosave = runtime.autosave ?? {
    status: runtime.pendingWrite
      ? "updating"
      : runtime.lastWriteError
        ? "error"
        : "updated",
    expectedSourceSha256:
      runtime.pendingWrite?.expectedSourceSha256
      ?? runtime.view?.renderedContentSha256,
    ...(runtime.pendingWrite
      ? {}
      : runtime.lastWriteError
        ? {
            errorCode: runtime.lastWriteError.code,
            errorMessage:
              runtime.lastWriteError.message
              ?? "The last source write did not complete.",
          }
        : { lastPersistedAt: runtime.updatedAt ?? timestamp }),
    recoveryLogRelativePath: "recovery/autosave-log.json",
  };
  const persistedConflict = runtime.conflict?.type === "autosave-source"
    ? {
        conflictId: runtime.conflict.conflictId,
        type: "autosave-source",
        detectedAt: runtime.conflict.detectedAt,
        expectedSourceSha256: runtime.conflict.expectedSourceSha256,
        externalSourceSha256: runtime.conflict.externalSourceSha256,
        candidateContentSha256: runtime.conflict.candidateContentSha256,
        candidateRecoveryRelativePath:
          runtime.conflict.candidateRecoveryRelativePath,
        editRevision: runtime.conflict.editRevision,
      }
    : runtime.conflict?.type === "ai-source"
      ? {
          conflictId: runtime.conflict.conflictId,
          type: "ai-source",
          transactionId: runtime.conflict.transactionId,
          requestId: runtime.conflict.requestId,
          attemptId: runtime.conflict.attemptId,
          candidateVersionId: runtime.conflict.candidateVersionId,
          detectedAt: runtime.conflict.detectedAt,
          expectedSourceSha256: runtime.conflict.expectedSourceSha256,
          externalSourceSha256: runtime.conflict.externalSourceSha256,
          candidateOutputSha256: runtime.conflict.candidateOutputSha256,
          candidateRelativePath: runtime.conflict.candidateRelativePath,
        }
      : null;
  const persisted = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId: runtime.projectId,
    documentId: runtime.documentId,
    updatedAt: timestamp,
    lifecycleState,
    projectLocked: locked,
    editRevision: runtime.editRevision,
    lastPersistedRevision: runtime.lastPersistedRevision,
    freezeCutoffRevision:
      activeRun
        ? runtime.freezeCutoffRevision
          ?? runtime.activeRun.freezeCutoffRevision
          ?? 0
        : null,
    autosave,
    pendingWrite: runtime.pendingWrite ?? null,
    pendingSubmission,
    view: runtime.view,
    draft: {
      annotationsRelativePath:
        draft.annotationsRelativePath ?? "draft/annotations.json",
      annotationsSha256: draft.annotationsSha256,
      commentIds:
        draft.commentIds
        ?? (draft.comments ?? []).map((item) => item.commentId).filter(Boolean),
      editEventIds:
        draft.editEventIds
        ?? (draft.changeEvents ?? []).map((item) => item.eventId).filter(Boolean),
      draftRevision:
        Number.isSafeInteger(draft.draftRevision) && draft.draftRevision >= 0
          ? draft.draftRevision
          : 0,
      updatedAt: draft.updatedAt ?? timestamp,
    },
    activeRun: lifecycleState === "submitting" ? null : activeRun,
    activeTransaction,
    ...(persistedConflict ? { conflict: persistedConflict } : {}),
    ...(lifecycleState === "recovering-transaction"
      ? {
          recovery:
            runtime.recovery
            ?? {
              transactionId: runtime.transactionId,
              transactionRelativePath:
                `transactions/${runtime.transactionId}/transaction.json`,
              enteredAt: timestamp,
            },
        }
      : {}),
  };
  const transientActiveRun = runtime.activeRun;
  const transientDraftComments = runtime.draft?.comments;
  const transientDraftEvents = runtime.draft?.changeEvents;
  const transientDeletedCommentIds = runtime.draft?.deletedCommentIds;
  const transientAppliedOperationIds = runtime.draft?.appliedOperationIds;
  await atomicWriteJson(
    path.join(projectRoot, "runtime-state.json"),
    persisted,
  );
  Object.assign(runtime, persisted);
  if (transientActiveRun) {
    runtime.activeRun = transientActiveRun;
  }
  if (transientDraftComments) {
    runtime.draft.comments = transientDraftComments;
  }
  if (transientDraftEvents) {
    runtime.draft.changeEvents = transientDraftEvents;
  }
  if (transientDeletedCommentIds) {
    runtime.draft.deletedCommentIds = transientDeletedCommentIds;
  }
  if (transientAppliedOperationIds) {
    runtime.draft.appliedOperationIds = transientAppliedOperationIds;
  }
  runtime.transactionId = transactionId;
}

async function createCommittedMarker(
  versionRoot,
  versionId,
  contentSha256,
  options = {},
) {
  const committedPath = path.join(versionRoot, "committed.json");
  if (await exists(committedPath)) {
    const existing = await readAuxiliaryJson(
      committedPath,
      "committed.json",
    );
    if (
      existing.schemaVersion !== "1.0.0"
      || existing.status !== "committed"
      || !["initial", "internal-ai"].includes(existing.sourceType)
      || existing.versionId !== versionId
      || existing.contentSha256 !== contentSha256
    ) {
      throw new HttpError(
        409,
        "COMMIT_MARKER_MISMATCH",
        "An existing commit marker does not match the Version being published.",
      );
    }
    return existing;
  }
  const manifestPath = path.join(versionRoot, "version.json");
  const manifestBuffer = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBuffer.toString("utf8"));
  assertLifecycleSchemaVersion(manifest, `${versionId}/version.json`);
  if (!["initial", "internal-ai"].includes(manifest.sourceType)) {
    throw new HttpError(
      409,
      "UNSUPPORTED_VERSION_SOURCE_TYPE",
      "Version sourceType must be initial or internal-ai.",
      { actual: manifest.sourceType ?? null },
    );
  }
  const common = {
    schemaVersion: "1.0.0",
    status: "committed",
    sourceType: manifest.sourceType,
    transactionId: options.transactionId ?? `txn_initial_${versionId}`,
    projectId: manifest.projectId,
    documentId: manifest.documentId,
    versionId,
    versionOrdinal: manifest.versionOrdinal,
    versionLabel: manifest.versionLabel,
    contentSha256,
    sourceSha256: options.sourceSha256 ?? contentSha256,
    manifestSha256: sha256(manifestBuffer),
    committedAt: options.committedAt ?? nowIso(),
  };
  const marker = common.sourceType === "internal-ai"
    ? {
        ...common,
        previousVersionId: manifest.previousVersionId,
        basedOnVersionId: manifest.basedOnVersionId,
        requestId: manifest.requestId,
        attemptId: manifest.attemptId,
        baseSnapshotSha256: manifest.baseSnapshotSha256,
        completionSha256: options.completionSha256,
      }
    : common;
  await atomicWriteJson(committedPath, marker);
  return marker;
}

async function createInitialProject(
  sourcePath,
  registry,
  expectedSourceSha256 = null,
) {
  const source = await readSourceFile(sourcePath);
  if (
    expectedSourceSha256
    && source.sha256 !== expectedSourceSha256
  ) {
    throw new HttpError(
      409,
      "SOURCE_HASH_CONFLICT",
      "The source HTML changed before project registration.",
      {
        expectedSourceSha256,
        actualSourceSha256: source.sha256,
      },
    );
  }
  const projectId = randomStableId("project");
  const documentId = randomStableId("doc");
  const displayName = projectDisplayName(sourcePath);
  const createdAt = nowIso();
  const {
    storageDirectoryName,
    projectRoot,
  } = await availableProjectStorageDirectory({
    displayName,
    createdAt,
    projectId,
    registry,
  });
  await ensureDirectory(projectRoot);
  for (const directory of [
    "versions",
    "requests",
    "transactions",
    "recovery",
    "draft",
    "history",
    "working",
  ]) {
    await ensureDirectory(path.join(projectRoot, directory));
  }
  const versionId = "ver_0001";
  const versionRoot = path.join(projectRoot, "versions", versionId);
  await ensureDirectory(path.join(versionRoot, "files"));
  await atomicWriteFile(
    path.join(versionRoot, "files", "index.html"),
    source.buffer,
  );
  const manifest = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId,
    documentId,
    versionId,
    versionOrdinal: 1,
    versionLabel: "V1",
    sourceType: "initial",
    generatedAt: createdAt,
    contentSha256: source.sha256,
    contentComparisonSha256: comparisonSha256(source.html),
    canonicalizationVersion: CANONICALIZATION_VERSION,
    summary: "初始登记基线",
    files: [
      {
        path: "files/index.html",
        role: "entry-html",
        mediaType: "text/html",
        byteLength: source.buffer.byteLength,
        sha256: source.sha256,
      },
    ],
  };
  await atomicWriteJson(path.join(versionRoot, "version.json"), manifest);
  await createCommittedMarker(versionRoot, versionId, source.sha256, {
    committedAt: createdAt,
    projectId,
    documentId,
  });
  const project = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId,
    documentId,
    displayName,
    createdAt,
    storageDirectoryName,
    sourcePath,
    latestVersionId: versionId,
    currentBasedOnVersionId: versionId,
    currentExactVersionId: versionId,
    currentHtmlSha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
  };
  await atomicWriteJson(path.join(projectRoot, "project.json"), project);
  const runtime = emptyRuntime(
    projectId,
    documentId,
    source.sha256,
    versionId,
  );
  await atomicWriteJson(
    path.join(projectRoot, "runtime-state.json"),
    runtime,
  );
  await atomicWriteFile(
    path.join(projectRoot, "draft", "annotations.json"),
    jsonText(draftArtifactRecord({
      draftRevision: runtime.draft.draftRevision,
      updatedAt: runtime.draft.updatedAt,
    })),
  );
  await atomicWriteFile(
    path.join(projectRoot, "PROJECT.md"),
    defaultProjectRules(),
  );
  registry.projects[projectId] = {
    displayName,
    createdAt,
    storageDirectoryName,
  };
  assignCurrentSourceIdentity(registry, {
    sourcePath,
    projectId,
    documentId,
    source,
  });
  await writeRegistry(registry);
  return { projectRoot, project };
}

async function initializeRoot() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (!(await exists(WORKSPACE_ROOT))) return emptyRegistry();
      const registry = await registryQueue.run(async () => {
        await ensureDirectory(PROJECTS_ROOT);
        await withProjectFileLock(WORKSPACE_ROOT, async () => {
          const current = await readRegistry();
          if (!(await exists(REGISTRY_PATH))) await writeRegistry(current);
        });
        return readRegistry();
      });
      for (const [projectId, record] of Object.entries(registry.projects)) {
        const context = {
          workspaceRoot: WORKSPACE_ROOT,
          projectId,
          documentId: record.documentId,
          sourcePath: record.sourcePath,
          displayName: record.displayName,
          createdAt: record.createdAt,
          storageDirectoryName: record.storageDirectoryName,
          projectRoot: projectRootFromRegistryRecord(projectId, record),
        };
        await withProjectFileLock(context.projectRoot, async () => {
          try {
            await recoverPendingWriteRaw(context);
            await recoverSubmittingRequestRaw(context);
            await recoverTransactionsRaw(context);
          } catch (error) {
            process.stderr.write(
              `${JSON.stringify({
                type: "recovery-error",
                projectId,
                error: {
                  code: error?.code ?? "RECOVERY_FAILED",
                  message:
                    error instanceof Error ? error.message : "Recovery failed.",
                },
              })}\n`,
            );
          }
        });
      }
    })();
  }
  return initializationPromise;
}

async function ensureWorkspaceStorage() {
  await ensureDirectory(WORKSPACE_ROOT);
  await ensureDirectory(PROJECTS_ROOT);
  await registryQueue.run(() =>
    withProjectFileLock(WORKSPACE_ROOT, async () => {
      if (!(await exists(REGISTRY_PATH))) {
        await writeRegistry(emptyRegistry());
      }
    })
  );
}

async function relinkRegisteredDocument(
  registry,
  documentRecord,
  sourcePath,
  source,
) {
  const projectId = documentRecord.projectId;
  const projectRoot = projectRootFromRegistryRecord(
    projectId,
    registry.projects[projectId],
  );
  const projectPath = path.join(projectRoot, "project.json");
  if (!(await exists(projectPath))) {
    throw new HttpError(
      409,
      "DOCUMENT_PROJECT_MISSING",
      "The document registry points to a missing project.",
    );
  }
  const project = await readLifecycleJson(projectPath, "project.json");
  const registryProject = registry.projects[projectId];
  if (
    project.projectId !== projectId
    || project.displayName !== registryProject.displayName
    || project.createdAt !== registryProject.createdAt
    || project.storageDirectoryName !== registryProject.storageDirectoryName
  ) {
    throw new HttpError(
      409,
      "PROJECT_IDENTITY_MISMATCH",
      "Project metadata does not match the project registry.",
    );
  }
  const previousSourcePath = project.sourcePath;
  const previousCanonicalSourcePath = await canonicalExistingSourcePath(
    previousSourcePath,
  );
  const isCanonicalPathMigration = previousCanonicalSourcePath === sourcePath;
  if (previousSourcePath !== sourcePath && await exists(previousSourcePath)) {
    try {
      const previousSource = await readSourceFile(previousSourcePath);
      const previousIsSameDocument = isSourceFileIdentity(documentRecord.fileIdentity)
        ? sameSourceFileIdentity(
            documentRecord.fileIdentity,
            sourceFileIdentity(previousSource),
          )
        : documentIdFromHtml(previousSource.html) === project.documentId;
      if (previousIsSameDocument && !isCanonicalPathMigration) {
        throw new HttpError(
          409,
          "DUPLICATE_DOCUMENT_IDENTITY",
          "The same document identity is present at two live paths.",
          {
            documentId: project.documentId,
            registeredSourcePath: previousSourcePath,
            requestedSourcePath: sourcePath,
          },
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const context = {
    workspaceRoot: WORKSPACE_ROOT,
    projectId,
    documentId: project.documentId,
    sourcePath,
    displayName: registry.projects[projectId].displayName,
    createdAt: registry.projects[projectId].createdAt,
    storageDirectoryName: registry.projects[projectId].storageDirectoryName,
    projectRoot,
  };
  project.sourcePath = sourcePath;
  if (previousSourcePath !== sourcePath) {
    project.name = path.basename(sourcePath, path.extname(sourcePath));
  }
  project.currentHtmlSha256 = source.sha256;
  project.currentExactVersionId = await exactVersionForHash(
    context,
    source.sha256,
  );
  project.lastModifiedAt = source.lastModifiedAt;
  await writeProject(context, project);
  if (isCanonicalPathMigration) {
    await canonicalizeProjectSourceRecords(registry, projectId, sourcePath);
  } else {
    for (const [key, value] of Object.entries(registry.sources)) {
      if (value?.projectId === projectId) delete registry.sources[key];
    }
  }
  const linkedRecord = assignCurrentSourceIdentity(registry, {
    sourcePath,
    projectId,
    documentId: project.documentId,
    source,
  });
  await writeRegistry(registry);
  return linkedRecord;
}

async function loadContextBySource(
  sourcePathValue,
  create = true,
  options = {},
) {
  await initializeRoot();
  const sourcePath = await canonicalExistingSourcePath(sourcePathValue);
  if (!(await exists(WORKSPACE_ROOT))) {
    // Merely inspecting an HTML file must not create an empty project tree.
    // Storage begins with the first real edit, attachment, or AI Request.
    await readSourceFile(sourcePath);
    if (!create) {
      throw new HttpError(
        404,
        "PROJECT_NOT_FOUND",
        "No project is registered for this source HTML.",
      );
    }
    await ensureWorkspaceStorage();
  }
  const fingerprint = sourceFingerprint(sourcePath);
  let record;
  let registeredProjectRecord = null;
  let canonicalFileIdentity = null;
  await registryQueue.run(() =>
    withProjectFileLock(WORKSPACE_ROOT, async () => {
      const registry = await readRegistry();
      const source = await readSourceFile(sourcePath);
      const observedFileIdentity = sourceFileIdentity(source);
      record = registry.sources[fingerprint];
      const embeddedDocumentId = documentIdFromHtml(source.html);
      let registryDirty = false;
      let physicalReplacement = false;
      if (record && isSourceFileIdentity(record.fileIdentity)) {
        if (!sameSourceFileIdentity(record.fileIdentity, observedFileIdentity)) {
          const { project, runtime } = await readRegisteredObservationState(
            registry,
            record,
          );
          // Repair the narrow crash window after a PageRoot-owned atomic
          // replacement reached disk but before project.json and the registry
          // sidecar were refreshed. pendingWrite is the durable proof for the
          // earlier half of that window. Legacy stamped files receive the same
          // one-time compatibility repair; neither path writes source bytes.
          const observation = classifySourceObservation({
            sourceSha256: source.sha256,
            embeddedDocumentId,
            registeredDocumentId: record.documentId,
            projectCurrentHtmlSha256: project.currentHtmlSha256,
            pendingTargetHtmlSha256: runtime.pendingWrite?.targetHtmlSha256,
          });
          if (observation !== "external-replacement") {
            registry.sources[fingerprint] = {
              ...record,
              ...sourceIdentityState(source),
            };
            record = registry.sources[fingerprint];
            if (project.sourcePath === sourcePath) {
              registry.projects[record.projectId] = {
                ...registry.projects[record.projectId],
                ...sourceIdentityState(source),
              };
              registry.documents[record.documentId] = {
                ...registry.documents[record.documentId],
                ...sourceIdentityState(source),
              };
            }
            registryDirty = true;
          } else {
            delete registry.sources[fingerprint];
            record = undefined;
            registryDirty = true;
            physicalReplacement = true;
          }
        }
      } else if (record) {
        const { project, runtime } = await readRegisteredObservationState(
          registry,
          record,
        );
        const observation = classifySourceObservation({
          sourceSha256: source.sha256,
          embeddedDocumentId,
          registeredDocumentId: record.documentId,
          projectCurrentHtmlSha256: project.currentHtmlSha256,
          pendingTargetHtmlSha256: runtime.pendingWrite?.targetHtmlSha256,
        });
        if (observation !== "external-replacement") {
          registry.sources[fingerprint] = {
            ...record,
            ...sourceIdentityState(source),
          };
          record = registry.sources[fingerprint];
          if (project.sourcePath === sourcePath) {
            registry.projects[record.projectId] = {
              ...registry.projects[record.projectId],
              ...sourceIdentityState(source),
            };
            registry.documents[record.documentId] = {
              ...registry.documents[record.documentId],
              ...sourceIdentityState(source),
            };
          }
          registryDirty = true;
        } else {
          delete registry.sources[fingerprint];
          record = undefined;
          registryDirty = true;
        }
      }
      if (!record && !physicalReplacement) {
        const physicalMatches = Object.values(registry.documents)
          .filter((value) => sameSourceFileIdentity(
            value?.fileIdentity,
            observedFileIdentity,
          ));
        const matchesByProject = new Map(
          physicalMatches.map((value) => [value.projectId, value]),
        );
        if (matchesByProject.size > 1) {
          throw new HttpError(
            409,
            "AMBIGUOUS_SOURCE_FILE_IDENTITY",
            "The moved HTML matches more than one registered project.",
          );
        }
        const [documentRecord] = matchesByProject.values();
        if (documentRecord) {
          record = await relinkRegisteredDocument(
            registry,
            documentRecord,
            sourcePath,
            source,
          );
          registryDirty = false;
        }
      }
      if (!record && !physicalReplacement && embeddedDocumentId) {
        const documentRecord = registry.documents[embeddedDocumentId];
        if (documentRecord && !isSourceFileIdentity(documentRecord.fileIdentity)) {
          record = await relinkRegisteredDocument(
            registry,
            documentRecord,
            sourcePath,
            source,
          );
          registryDirty = false;
        }
      }
      if (!record && create) {
        if (
          options.expectedSourceSha256
          && source.sha256 !== options.expectedSourceSha256
        ) {
          throw new HttpError(
            409,
            "SOURCE_HASH_CONFLICT",
            "The source HTML changed before project registration.",
            {
              expectedSourceSha256: options.expectedSourceSha256,
              actualSourceSha256: source.sha256,
            },
          );
        }
        const created = await createInitialProject(
          sourcePath,
          registry,
          options.expectedSourceSha256,
        );
        record = {
          sourcePath,
          projectId: created.project.projectId,
          documentId: created.project.documentId,
        };
        registryDirty = false;
      }
      if (registryDirty) await writeRegistry(registry);
      if (record) {
        registeredProjectRecord = registry.projects[record.projectId] ?? null;
        canonicalFileIdentity = registeredProjectRecord?.fileIdentity ?? null;
      }
    }),
  );
  if (!record) {
    throw new HttpError(
      404,
      "PROJECT_NOT_FOUND",
      "No project is registered for this source HTML.",
    );
  }
  if (record.sourcePath !== sourcePath) {
    throw new HttpError(
      409,
      "SOURCE_REGISTRY_MISMATCH",
      "The registered source path does not match.",
    );
  }
  const canonicalSourcePath = await canonicalExistingSourcePath(
    record.canonicalSourcePath ?? record.sourcePath,
  );
  if (canonicalSourcePath !== sourcePath) {
    const canonicalSource = await readSourceFile(canonicalSourcePath);
    const canonicalIdentityMatches = isSourceFileIdentity(canonicalFileIdentity)
      ? sameSourceFileIdentity(
          canonicalFileIdentity,
          sourceFileIdentity(canonicalSource),
        )
      : documentIdFromHtml(canonicalSource.html) === record.documentId;
    if (!canonicalIdentityMatches) {
      throw new HttpError(
        409,
        "CANONICAL_SOURCE_IDENTITY_MISMATCH",
        "The active project HTML no longer matches its registered identity.",
      );
    }
  }
  return {
    workspaceRoot: WORKSPACE_ROOT,
    projectId: record.projectId,
    documentId: record.documentId,
    sourcePath: canonicalSourcePath,
    requestedSourcePath: sourcePath,
    displayName: registeredProjectRecord.displayName,
    createdAt: registeredProjectRecord.createdAt,
    storageDirectoryName: registeredProjectRecord.storageDirectoryName,
    projectRoot: projectRootFromRegistryRecord(
      record.projectId,
      registeredProjectRecord,
    ),
  };
}

async function loadMutationContext(body) {
  let identity;
  try {
    identity = registeredCommandIdentity(body);
  } catch (error) {
    throw projectContextHttpError(error);
  }

  // Backward-compatible tests and older local clients may omit both IDs. They
  // can address an existing registration by path, but only /project/ensure is
  // allowed to create one.
  if (!identity) return loadContextBySource(body.sourcePath, false);

  await initializeRoot();
  const requestedSourcePath = await canonicalExistingSourcePath(body.sourcePath);
  if (!(await exists(WORKSPACE_ROOT))) {
    throw new HttpError(
      404,
      "REGISTERED_PROJECT_NOT_FOUND",
      "The registered project is no longer available.",
    );
  }

  let contextRecord;
  await registryQueue.run(() =>
    withProjectFileLock(WORKSPACE_ROOT, async () => {
      const registry = await readRegistry();
      let selected;
      try {
        selected = registeredProjectRecord(registry, identity);
      } catch (error) {
        throw projectContextHttpError(error);
      }
      const registeredSourcePath = await canonicalExistingSourcePath(
        selected.project.sourcePath ?? selected.document.sourcePath,
      );
      const requestedRecord = registry.sources[
        sourceFingerprint(requestedSourcePath)
      ];
      const requestedAliasMatches = Boolean(
        requestedRecord
        && requestedRecord.projectId === identity.projectId
        && requestedRecord.documentId === identity.documentId
      );
      if (
        registeredSourcePath !== requestedSourcePath
        && !requestedAliasMatches
      ) {
        throw new HttpError(
          409,
          "PROJECT_CONTEXT_PATH_MISMATCH",
          "The command source path does not belong to its registered project.",
        );
      }
      const source = await readSourceFile(registeredSourcePath);
      const observedFileIdentity = sourceFileIdentity(source);
      const registeredSourceRecord = registry.sources[
        sourceFingerprint(registeredSourcePath)
      ];
      const registryObservationMatches = Boolean(
        registeredSourceRecord
        && registeredSourceRecord.projectId === identity.projectId
        && registeredSourceRecord.documentId === identity.documentId
        && [registeredSourceRecord, selected.project, selected.document]
          .every((record) => (
            sameSourceFileIdentity(record.fileIdentity, observedFileIdentity)
            && record.confirmedSourceSha256 === source.sha256
          )),
      );
      if (!registryObservationMatches) {
        const { project, runtime } = await readRegisteredObservationState(
          registry,
          { projectId: identity.projectId },
        );
        const observation = classifySourceObservation({
          sourceSha256: source.sha256,
          embeddedDocumentId: documentIdFromHtml(source.html),
          registeredDocumentId: identity.documentId,
          projectCurrentHtmlSha256: project.currentHtmlSha256,
          pendingTargetHtmlSha256: runtime.pendingWrite?.targetHtmlSha256,
        });
        const activeConflictOwnsSource = Boolean(
          runtime.lifecycleState === "awaiting-conflict-resolution"
          && ["autosave-source", "ai-source"].includes(runtime.conflict?.type)
          && runtime.conflict.externalSourceSha256 === source.sha256,
        );
        const readyTransactionId =
          runtime.lifecycleState === "ready-to-open"
          && runtime.activeRun?.requestId
          && runtime.activeRun?.attemptId
            ? `txn_${runtime.activeRun.requestId}_${runtime.activeRun.attemptId}`
            : null;
        let readyTransactionOwnsSource = false;
        if (
          observation === "external-replacement"
          && !activeConflictOwnsSource
          && readyTransactionId
        ) {
          const projectRoot = projectRootFromRegistryRecord(
            identity.projectId,
            selected.project,
          );
          const transactionPath = path.join(
            projectRoot,
            "transactions",
            readyTransactionId,
            "transaction.json",
          );
          if (await exists(transactionPath)) {
            const transaction = await readAuxiliaryJson(
              transactionPath,
              "transaction.json",
            );
            readyTransactionOwnsSource = Boolean(
              transaction.state === "ready-to-open"
              && transaction.projectId === identity.projectId
              && transaction.documentId === identity.documentId
              && transaction.expectedSourceSha256 === source.sha256,
            );
          } else {
            // A PR-1 pending Candidate deliberately has no transaction or
            // Version yet. Its sealed request is still sufficient durable
            // authority to surface the external-source conflict only when the
            // user tries to adopt it.
            readyTransactionOwnsSource = await exists(path.join(
              projectRoot,
              "requests",
              runtime.activeRun.requestId,
              "attempts",
              runtime.activeRun.attemptId,
              "candidate.json",
            ));
          }
        }
        const durableExternalObservation =
          activeConflictOwnsSource || readyTransactionOwnsSource;
        if (
          observation === "external-replacement"
          && !durableExternalObservation
        ) {
          throw new HttpError(
            409,
            "PROJECT_CONTEXT_SOURCE_REPLACED",
            "The registered project HTML was replaced by an unrelated file.",
          );
        }
        if (!durableExternalObservation) {
          assignCurrentSourceIdentity(registry, {
            sourcePath: registeredSourcePath,
            projectId: identity.projectId,
            documentId: identity.documentId,
            source,
          });
          await writeRegistry(registry);
        }
      }
      contextRecord = {
        project: selected.project,
        sourcePath: registeredSourcePath,
      };
    }),
  );

  return {
    workspaceRoot: WORKSPACE_ROOT,
    projectId: identity.projectId,
    documentId: identity.documentId,
    sourcePath: contextRecord.sourcePath,
    requestedSourcePath,
    displayName: contextRecord.project.displayName,
    createdAt: contextRecord.project.createdAt,
    storageDirectoryName: contextRecord.project.storageDirectoryName,
    projectRoot: projectRootFromRegistryRecord(
      identity.projectId,
      contextRecord.project,
    ),
  };
}

async function withProjectMutation(context, task) {
  return projectQueue(context.projectId).run(() =>
    withProjectFileLock(context.projectRoot, task)
  );
}

function assertBodyContext(context, body) {
  if (body.projectId && body.projectId !== context.projectId) {
    throw new HttpError(
      409,
      "PROJECT_ID_MISMATCH",
      "projectId does not match sourcePath.",
    );
  }
  if (body.documentId && body.documentId !== context.documentId) {
    throw new HttpError(
      409,
      "DOCUMENT_ID_MISMATCH",
      "documentId does not match sourcePath.",
    );
  }
}

async function readProject(context) {
  const project = await readLifecycleJson(
    path.join(context.projectRoot, "project.json"),
    "project.json",
  );
  if (
    project.projectId !== context.projectId
    || project.documentId !== context.documentId
    || project.sourcePath !== context.sourcePath
    || project.displayName !== context.displayName
    || project.createdAt !== context.createdAt
    || project.storageDirectoryName !== context.storageDirectoryName
    || typeof project.displayName !== "string"
    || project.displayName.trim().length === 0
    || typeof project.createdAt !== "string"
    || Number.isNaN(Date.parse(project.createdAt))
  ) {
    throw new HttpError(
      409,
      "PROJECT_IDENTITY_MISMATCH",
      "Project metadata does not match the source registry.",
    );
  }
  return project;
}

async function readRuntime(context, { hydrateArtifacts = true } = {}) {
  const runtime = await readLifecycleJson(
    path.join(context.projectRoot, "runtime-state.json"),
    "runtime-state.json",
  );
  if (
    runtime.projectId !== context.projectId
    || runtime.documentId !== context.documentId
  ) {
    throw new HttpError(
      409,
      "RUNTIME_IDENTITY_MISMATCH",
      "runtime-state.json does not match project identity.",
    );
  }
  const draftRelativePath =
    runtime.draft?.annotationsRelativePath
    ?? "draft/annotations.json";
  const draftPath = path.join(
    context.projectRoot,
    ...draftRelativePath.split("/"),
  );
  if (!hydrateArtifacts) {
    runtime.draft.comments = [];
    runtime.draft.changeEvents = [];
    runtime.draft.deletedCommentIds = [];
    runtime.draft.appliedOperationIds = [];
  } else if (await exists(draftPath)) {
    const draftRecords = await readAuxiliaryJson(
      draftPath,
      "draft/annotations.json",
    );
    const runtimeDraftRevision = Number(runtime.draft?.draftRevision);
    const artifactDraftRevision = Number(draftRecords.draftRevision);
    const hasArtifactRevision =
      Number.isSafeInteger(artifactDraftRevision)
      && artifactDraftRevision >= 0;
    if (
      hasArtifactRevision
      && Number.isSafeInteger(runtimeDraftRevision)
      && artifactDraftRevision < runtimeDraftRevision
    ) {
      throw new HttpError(
        409,
        "DRAFT_ARTIFACT_REVISION_REGRESSION",
        "draft/annotations.json is older than its runtime pointer.",
        {
          runtimeDraftRevision,
          artifactDraftRevision,
        },
      );
    }
    if (
      hasArtifactRevision
      && Number.isSafeInteger(runtimeDraftRevision)
      && artifactDraftRevision > runtimeDraftRevision + 1
    ) {
      throw new HttpError(
        409,
        "DRAFT_ARTIFACT_REVISION_JUMP",
        "draft/annotations.json is more than one revision ahead of its runtime pointer.",
        {
          runtimeDraftRevision,
          artifactDraftRevision,
        },
      );
    }
    const artifactBuffer = await readFile(draftPath);
    const artifactSha256 = sha256(artifactBuffer);
    if (
      (!hasArtifactRevision || artifactDraftRevision === runtimeDraftRevision)
      && runtime.draft?.annotationsSha256
      && runtime.draft.annotationsSha256 !== artifactSha256
    ) {
      throw new HttpError(
        409,
        "DRAFT_ARTIFACT_HASH_MISMATCH",
        "draft/annotations.json does not match its runtime pointer.",
      );
    }
    if (hasArtifactRevision) {
      runtime.draft.draftRevision = artifactDraftRevision;
    }
    if (typeof draftRecords.updatedAt === "string" && draftRecords.updatedAt) {
      runtime.draft.updatedAt = draftRecords.updatedAt;
    }
    runtime.draft.annotationsSha256 = artifactSha256;
    runtime.draft.comments = Array.isArray(draftRecords.comments)
      ? draftRecords.comments
      : [];
    runtime.draft.changeEvents = Array.isArray(draftRecords.editEvents)
      ? draftRecords.editEvents
      : [];
    runtime.draft.deletedCommentIds = Array.isArray(
      draftRecords.deletedCommentIds,
    )
      ? draftRecords.deletedCommentIds
      : [];
    runtime.draft.appliedOperationIds = Array.isArray(
      draftRecords.appliedOperationIds,
    )
      ? draftRecords.appliedOperationIds
      : [];
  } else {
    runtime.draft.comments = [];
    runtime.draft.changeEvents = [];
    runtime.draft.deletedCommentIds = [];
    runtime.draft.appliedOperationIds = [];
  }
  if (
    !runtime.activeRun
    && runtime.lifecycleState === "submitting"
    && runtime.pendingSubmission
  ) {
    runtime.activeRun = {
      ...runtime.pendingSubmission,
      submittedAt: runtime.pendingSubmission.lockedAt,
    };
  }
  if (runtime.activeRun) {
    const activeRun = runtime.activeRun;
    const requestRoot = path.join(
      context.projectRoot,
      "requests",
      activeRun.requestId,
    );
    const attemptRoot = path.join(
      requestRoot,
      "attempts",
      activeRun.attemptId,
    );
    const outputRelativePath = activeRun.outputRelativePath
      ?? `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/output/index.html`;
    Object.assign(activeRun, {
      projectId: context.projectId,
      documentId: context.documentId,
      sourcePath: context.sourcePath,
      status: runtime.lifecycleState,
      requestPath: requestRoot,
      attemptPath: attemptRoot,
      promptPath: path.join(requestRoot, "PROMPT.md"),
      outputPath: path.join(context.projectRoot, ...outputRelativePath.split("/")),
      completionPath: path.join(attemptRoot, "completion.json"),
      freezeCutoffRevision: runtime.freezeCutoffRevision,
      createdAt: activeRun.submittedAt,
      updatedAt: runtime.updatedAt,
      handoffMessage:
        `请执行 ${requestRoot}/PROMPT.md 中的单轮任务，完成后运行其中的最终化（finalizer）命令。`,
    });
    const annotationsPath = path.join(
      context.projectRoot,
      ...(
        activeRun.frozenAnnotationsRelativePath
        ?? `requests/${activeRun.requestId}/input/annotations/records.json`
      ).split("/"),
    );
    if (!hydrateArtifacts) {
      activeRun.frozenComments = [];
      activeRun.frozenChangeEvents = [];
      activeRun.commentCount = activeRun.frozenCommentIds?.length ?? 0;
      activeRun.changeEventCount = activeRun.frozenEditEventIds?.length ?? 0;
    } else if (await exists(annotationsPath)) {
      const frozen = await readLifecycleJson(
        annotationsPath,
        "frozen annotations",
      );
      activeRun.frozenComments = frozen.comments;
      activeRun.frozenChangeEvents = frozen.editEvents;
      activeRun.commentCount = activeRun.frozenComments.length;
      activeRun.changeEventCount = activeRun.frozenChangeEvents.length;
    } else {
      activeRun.frozenComments = [];
      activeRun.frozenChangeEvents = [];
    }
    const changeRequestPath = path.join(requestRoot, "change-request.json");
    if (hydrateArtifacts && await exists(changeRequestPath)) {
      const changeRequest = await readLifecycleJson(
        changeRequestPath,
        "change-request.json",
      );
      activeRun.summary = changeRequest.requirements.summary;
    }
  }
  runtime.transactionId =
    runtime.activeTransaction?.transactionId
    ?? runtime.recovery?.transactionId
    ?? null;
  runtime.lastWriteError = ["error", "external-conflict"].includes(
    runtime.autosave?.status,
  )
    ? {
        code: runtime.autosave.errorCode,
        message: runtime.autosave.errorMessage,
        at: runtime.updatedAt,
      }
    : null;
  return runtime;
}

function sourceTransactionAdapters() {
  return {
    createHttpError: (status, code, message, details) =>
      new HttpError(status, code, message, details),
    readSourceFile,
    readRuntime,
    writeRuntime,
    readProject,
    writeProject,
    syncCurrentSourceIdentity,
    exactVersionForHash,
    appendAuditOnce,
    maybeFailpoint,
  };
}

async function recoverPendingWriteRaw(context) {
  return recoverPendingSourceTransaction(context, sourceTransactionAdapters());
}
async function validateRequestPublicationRaw(context, activeRun, requestRoot) {
  const manifestPath = path.join(requestRoot, "input-manifest.json");
  const manifestBuffer = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    throw new HttpError(
      422,
      "INVALID_JSON_FILE",
      "input-manifest.json is not valid JSON.",
    );
  }
  assertAuxiliarySchemaVersion(manifest, "input-manifest.json");
  const manifestSha256 = sha256(manifestBuffer);
  if (
    activeRun.inputManifestSha256
    && activeRun.inputManifestSha256 !== manifestSha256
  ) {
    throw new HttpError(
      409,
      "INPUT_MANIFEST_HASH_MISMATCH",
      "The Request publication does not match its durable intent.",
    );
  }
  for (const [key, expected] of [
    ["projectId", context.projectId],
    ["documentId", context.documentId],
    ["requestId", activeRun.requestId],
    ["attemptId", activeRun.attemptId],
  ]) {
    if (manifest[key] !== expected) {
      throw new HttpError(
        409,
        "REQUEST_PUBLICATION_IDENTITY_MISMATCH",
        `Published input-manifest.json ${key} is invalid.`,
      );
    }
  }
  if (manifest.frozen !== true || !Array.isArray(manifest.files)) {
    throw new HttpError(
      409,
      "REQUEST_PUBLICATION_INCOMPLETE",
      "Published Request is missing its frozen file inventory.",
    );
  }
  const inventoriedPaths = new Set();
  for (const record of manifest.files) {
    const relativePath = String(record?.path ?? "").replaceAll("\\", "/");
    if (
      !relativePath
      || path.posix.normalize(relativePath) !== relativePath
      || relativePath.startsWith("../")
      || path.isAbsolute(relativePath)
    ) {
      throw new HttpError(
        409,
        "REQUEST_PUBLICATION_INVALID_PATH",
        "Published Request contains an unsafe manifest path.",
      );
    }
    if (inventoriedPaths.has(relativePath)) {
      throw new HttpError(
        409,
        "REQUEST_PUBLICATION_DUPLICATE_PATH",
        `Published Request inventories ${relativePath} more than once.`,
      );
    }
    inventoriedPaths.add(relativePath);
    const buffer = await readFile(
      path.join(requestRoot, ...relativePath.split("/")),
    );
    if (
      record.sha256 !== sha256(buffer)
      || record.byteLength !== buffer.byteLength
    ) {
      throw new HttpError(
        409,
        "REQUEST_PUBLICATION_HASH_MISMATCH",
        `Published Request file ${relativePath} failed integrity validation.`,
      );
    }
  }
  if (!Array.isArray(manifest.readOrder)) {
    throw new HttpError(
      409,
      "REQUEST_PUBLICATION_INCOMPLETE",
      "Published Request is missing its ordered AI read set.",
    );
  }
  const readPaths = new Set();
  for (const value of manifest.readOrder) {
    const relativePath = String(value ?? "").replaceAll("\\", "/");
    if (
      !relativePath
      || path.posix.normalize(relativePath) !== relativePath
      || relativePath.startsWith("../")
      || path.isAbsolute(relativePath)
      || !inventoriedPaths.has(relativePath)
      || readPaths.has(relativePath)
    ) {
      throw new HttpError(
        409,
        "REQUEST_PUBLICATION_INVALID_READ_ORDER",
        "Published Request contains an invalid AI readOrder entry.",
        { relativePath },
      );
    }
    readPaths.add(relativePath);
  }
  for (const requiredPath of [
    "PROMPT.md",
    "input/AI_RULES.md",
    "change-request.json",
    "input/PROJECT.md",
    "input/base/index.html",
  ]) {
    if (!readPaths.has(requiredPath)) {
      throw new HttpError(
        409,
        "REQUEST_PUBLICATION_INCOMPLETE",
        `Published Request readOrder omits ${requiredPath}.`,
      );
    }
  }
  const attemptRoot = path.join(
    requestRoot,
    "attempts",
    activeRun.attemptId,
    "output",
  );
  const attemptInformation = await lstat(attemptRoot);
  if (attemptInformation.isSymbolicLink() || !attemptInformation.isDirectory()) {
    throw new HttpError(
      409,
      "REQUEST_PUBLICATION_INCOMPLETE",
      "Published Request is missing its Attempt output directory.",
    );
  }
  return { manifestSha256 };
}

async function recoverSubmittingRequestRaw(context) {
  const runtime = await readRuntime(context);
  if (runtime.lifecycleState !== "submitting" || !runtime.activeRun) return null;
  const activeRun = runtime.activeRun;
  const requestsRoot = path.join(context.projectRoot, "requests");
  const requestRoot = path.join(requestsRoot, activeRun.requestId);
  let published = await exists(requestRoot);
  if (!published) {
    const entries = await readdir(requestsRoot, { withFileTypes: true });
    const temporary = entries.find(
      (entry) =>
        entry.isDirectory()
        && !entry.isSymbolicLink()
        && entry.name.startsWith(`.${activeRun.requestId}.`)
        && entry.name.endsWith(".tmp"),
    );
    if (temporary) {
      const temporaryRoot = path.join(requestsRoot, temporary.name);
      try {
        const validated = await validateRequestPublicationRaw(
          context,
          activeRun,
          temporaryRoot,
        );
        activeRun.inputManifestSha256 = validated.manifestSha256;
        await rename(temporaryRoot, requestRoot);
        await syncDirectory(requestsRoot);
        published = true;
      } catch (error) {
        await rm(temporaryRoot, { recursive: true, force: true });
        runtime.lifecycleState = "editing";
        runtime.activeRun = null;
        runtime.lastCompleted = {
          schemaVersion: LIFECYCLE_SCHEMA_VERSION,
          status: "request-publication-rolled-back",
          requestId: activeRun.requestId,
          attemptId: activeRun.attemptId,
          error: {
            code: error?.code ?? "REQUEST_PUBLICATION_INCOMPLETE",
            message: error instanceof Error ? error.message : "Invalid Request.",
          },
          completedAt: nowIso(),
        };
        await writeRuntime(context.projectRoot, runtime);
        return runtime.lastCompleted;
      }
    }
  }
  if (!published) {
    runtime.lifecycleState = "editing";
    runtime.activeRun = null;
    runtime.lastCompleted = {
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
      status: "request-publication-rolled-back",
      requestId: activeRun.requestId,
      attemptId: activeRun.attemptId,
      error: {
        code: "REQUEST_PUBLICATION_NOT_STARTED",
        message: "The interrupted Request had not published any artifacts.",
      },
      completedAt: nowIso(),
    };
    await writeRuntime(context.projectRoot, runtime);
    return runtime.lastCompleted;
  }
  const validated = await validateRequestPublicationRaw(
    context,
    activeRun,
    requestRoot,
  );
  activeRun.inputManifestSha256 = validated.manifestSha256;
  activeRun.status = "processing";
  activeRun.updatedAt = nowIso();
  runtime.lifecycleState = "processing";
  runtime.activeRun = activeRun;
  await writeRuntime(context.projectRoot, runtime);
  return {
    status: "processing",
    recovered: true,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
  };
}

async function writeProject(context, project) {
  project.schemaVersion = LIFECYCLE_SCHEMA_VERSION;
  const persisted = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId: project.projectId,
    documentId: project.documentId,
    displayName: project.displayName,
    createdAt: project.createdAt,
    storageDirectoryName: project.storageDirectoryName,
    sourcePath: project.sourcePath,
    latestVersionId: project.latestVersionId,
    currentBasedOnVersionId: project.currentBasedOnVersionId,
    currentExactVersionId: project.currentExactVersionId,
    currentHtmlSha256: project.currentHtmlSha256,
    lastModifiedAt: project.lastModifiedAt,
    ...(project.restoredFromVersionId
      ? { restoredFromVersionId: project.restoredFromVersionId }
      : {}),
  };
  Object.assign(project, persisted);
  await atomicWriteJson(
    path.join(context.projectRoot, "project.json"),
    persisted,
  );
}

async function appendAudit(context, event) {
  const auditPath = path.join(context.projectRoot, "edit-audit.jsonl");
  const handle = await open(auditPath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function auditEventKey(event) {
  return `${String(event?.eventId ?? "")}\u0000${String(event?.editRevision ?? "")}`;
}

async function appendAuditOnce(context, event) {
  const auditPath = path.join(context.projectRoot, "edit-audit.jsonl");
  if (await exists(auditPath)) {
    const existingText = await readFile(auditPath, "utf8");
    const expectedKey = auditEventKey(event);
    for (const line of existingText.split("\n")) {
      if (!line.trim()) continue;
      try {
        if (auditEventKey(JSON.parse(line)) === expectedKey) return false;
      } catch {
        // Preserve malformed historical evidence, but start the replayed
        // record on a fresh line so it remains independently parseable.
      }
    }
    if (existingText && !existingText.endsWith("\n")) {
      const handle = await open(auditPath, "a", 0o600);
      try {
        await handle.writeFile("\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  await appendAudit(context, event);
  return true;
}

function versionIntegrityError(versionId, message, details) {
  return new HttpError(
    409,
    "VERSION_INTEGRITY_VIOLATION",
    `${versionId}: ${message}`,
    details,
  );
}

async function readValidatedVersionAnnotations(
  context,
  versionId,
  versionRoot,
  manifest,
) {
  const archive = manifest.annotationArchive;
  if (!archive) return null;

  if (!/^sha256:[a-f0-9]{64}$/.test(String(archive.sha256 ?? ""))) {
    throw versionIntegrityError(
      versionId,
      "annotation archive hash is invalid.",
    );
  }
  const expectedPaths = {
    versionRelativePath: "annotations/records.json",
    requestRelativePath:
      `requests/${manifest.requestId}/input/annotations/records.json`,
    attemptRelativePath:
      `requests/${manifest.requestId}/attempts/${manifest.attemptId}/annotations.json`,
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (archive[key] !== expected) {
      throw versionIntegrityError(
        versionId,
        `annotation archive ${key} does not match the Version identity.`,
        { expected, actual: archive[key] },
      );
    }
  }

  const annotationPaths = [
    path.join(versionRoot, "annotations", "records.json"),
    path.join(
      context.projectRoot,
      ...expectedPaths.requestRelativePath.split("/"),
    ),
    path.join(
      context.projectRoot,
      ...expectedPaths.attemptRelativePath.split("/"),
    ),
  ];
  const annotationBuffers = [];
  for (const annotationPath of annotationPaths) {
    const information = await lstat(annotationPath).catch((error) => {
      if (error?.code === "ENOENT") {
        throw versionIntegrityError(
          versionId,
          "an annotation archive copy is missing.",
          { annotationPath },
        );
      }
      throw error;
    });
    if (information.isSymbolicLink() || !information.isFile()) {
      throw versionIntegrityError(
        versionId,
        "annotation archive copies must be regular files.",
        { annotationPath },
      );
    }
    const buffer = await readFile(annotationPath);
    if (sha256(buffer) !== archive.sha256) {
      throw versionIntegrityError(
        versionId,
        "annotation archive paths do not share the manifest hash.",
        { annotationPath },
      );
    }
    annotationBuffers.push(buffer);
  }

  let annotations;
  try {
    annotations = JSON.parse(annotationBuffers[0].toString("utf8"));
  } catch {
    throw versionIntegrityError(
      versionId,
      "annotation archive is not valid JSON.",
    );
  }
  assertLifecycleSchemaVersion(
    annotations,
    `${versionId} annotation archive`,
  );
  if (
    !annotations
    || typeof annotations !== "object"
    || Array.isArray(annotations)
    || !Array.isArray(annotations.comments)
    || !Array.isArray(annotations.editEvents)
  ) {
    throw versionIntegrityError(
      versionId,
      "annotation archive must contain comments and editEvents arrays.",
    );
  }
  const expectedIdentity = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: manifest.requestId,
    attemptId: manifest.attemptId,
    basedOnVersionId: manifest.basedOnVersionId,
    baseSnapshotSha256: manifest.baseSnapshotSha256,
  };
  for (const [key, expected] of Object.entries(expectedIdentity)) {
    if (annotations[key] !== expected) {
      throw versionIntegrityError(
        versionId,
        `annotation archive ${key} does not match the Version identity.`,
        { expected, actual: annotations[key] },
      );
    }
  }
  if (
    archive.commentCount !== annotations.comments.length
    || archive.editEventCount !== annotations.editEvents.length
  ) {
    throw versionIntegrityError(
      versionId,
      "annotation archive counts do not match its immutable records.",
      {
        expectedCommentCount: archive.commentCount,
        actualCommentCount: annotations.comments.length,
        expectedEditEventCount: archive.editEventCount,
        actualEditEventCount: annotations.editEvents.length,
      },
    );
  }
  return annotations;
}

async function validateCommittedVersionRaw(context, versionId) {
  const versionRoot = path.join(context.projectRoot, "versions", versionId);
  const committedPath = path.join(versionRoot, "committed.json");
  const manifestPath = path.join(versionRoot, "version.json");
  const entryPath = path.join(versionRoot, "files", "index.html");
  if (!(await exists(committedPath))) {
    throw versionIntegrityError(
      versionId,
      "commit marker is missing.",
    );
  }
  for (const [filePath, label] of [
    [committedPath, "commit marker"],
    [manifestPath, "manifest"],
    [entryPath, "entry HTML"],
  ]) {
    const information = await lstat(filePath).catch((error) => {
      if (error?.code === "ENOENT") {
        throw versionIntegrityError(versionId, `${label} is missing.`);
      }
      throw error;
    });
    if (information.isSymbolicLink() || !information.isFile()) {
      throw versionIntegrityError(
        versionId,
        `${label} must be a regular file.`,
      );
    }
  }
  const [manifest, committed, entryBuffer] = await Promise.all([
    readLifecycleJson(manifestPath, `${versionId}/version.json`),
    readAuxiliaryJson(committedPath, `${versionId}/committed.json`),
    readFile(entryPath),
  ]);
  if (!["initial", "internal-ai"].includes(manifest.sourceType)) {
    throw versionIntegrityError(
      versionId,
      "manifest sourceType must be initial or internal-ai.",
      { actual: manifest.sourceType ?? null },
    );
  }
  if (
    committed.schemaVersion !== "1.0.0"
    || committed.status !== "committed"
    || committed.sourceType !== manifest.sourceType
    || committed.projectId !== context.projectId
    || committed.documentId !== context.documentId
    || manifest.projectId !== context.projectId
    || manifest.documentId !== context.documentId
  ) {
    throw versionIntegrityError(
      versionId,
      "Version identity or commit marker schema is invalid.",
    );
  }
  requireCompleteHtml(entryBuffer.toString("utf8"), `${versionId} entry HTML`);
  const actualSha256 = sha256(entryBuffer);
  if (committed.versionId !== versionId) {
    throw versionIntegrityError(
      versionId,
      "commit marker identity does not match its directory.",
      { expectedVersionId: versionId, actualVersionId: committed.versionId },
    );
  }
  requireSha256(committed.contentSha256, "committed.contentSha256");
  if (committed.contentSha256 !== actualSha256) {
    throw versionIntegrityError(
      versionId,
      "entry HTML does not match the commit marker.",
      {
        expectedSha256: committed.contentSha256,
        actualSha256,
      },
    );
  }
  if (manifest.versionId !== versionId) {
    throw versionIntegrityError(
      versionId,
      "manifest identity does not match its directory.",
      { expectedVersionId: versionId, actualVersionId: manifest.versionId },
    );
  }
  const entryRecords = Array.isArray(manifest.files)
    ? manifest.files.filter(
        (record) =>
          record?.path === "files/index.html"
          && record?.role === "entry-html",
      )
    : [];
  if (entryRecords.length !== 1) {
    throw versionIntegrityError(
      versionId,
      "manifest must contain exactly one entry-html record.",
    );
  }
  const entryRecord = entryRecords[0];
  requireSha256(entryRecord.sha256, "version.files entry sha256");
  if (
    entryRecord.sha256 !== actualSha256
    || entryRecord.byteLength !== entryBuffer.byteLength
  ) {
    throw versionIntegrityError(
      versionId,
      "entry HTML does not match its manifest file record.",
      {
        manifestSha256: entryRecord.sha256,
        actualSha256,
        manifestByteLength: entryRecord.byteLength,
        actualByteLength: entryBuffer.byteLength,
      },
    );
  }
  if (
    manifest.contentSha256 !== undefined
    && manifest.contentSha256 !== actualSha256
  ) {
    throw versionIntegrityError(
      versionId,
      "manifest content hash does not match entry HTML.",
      {
        manifestSha256: manifest.contentSha256,
        actualSha256,
      },
    );
  }
  if (
    committed.manifestSha256 !== undefined
    && committed.manifestSha256 !== sha256(await readFile(manifestPath))
  ) {
    throw versionIntegrityError(
      versionId,
      "manifest does not match the commit marker.",
    );
  }
  const annotations = await readValidatedVersionAnnotations(
    context,
    versionId,
    versionRoot,
    manifest,
  );
  return {
    versionRoot,
    manifest,
    committed,
    entryPath,
    entryBuffer,
    contentSha256: actualSha256,
    annotations,
  };
}

async function exactVersionForHash(context, contentSha256) {
  const versionIds = await listIds(
    path.join(context.projectRoot, "versions"),
    /^ver_\d{4,}$/,
  );
  for (const versionId of versionIds.reverse()) {
    const versionRoot = path.join(context.projectRoot, "versions", versionId);
    if (!(await exists(path.join(versionRoot, "committed.json")))) {
      continue;
    }
    const validated = await validateCommittedVersionRaw(context, versionId);
    if (validated.contentSha256 === contentSha256) return versionId;
  }
  return null;
}

function assertProjectMutable(runtime) {
  if (
    runtime.activeRun
    || !["editing", "ready"].includes(runtime.lifecycleState)
    || runtime.conflict
    || runtime.pendingWrite
  ) {
    throw new HttpError(
      423,
      "PROJECT_LOCKED",
      "The project is locked by an active operation or unresolved conflict.",
      {
        lifecycleState: runtime.lifecycleState,
        activeRun: runtime.activeRun
          ? {
              requestId: runtime.activeRun.requestId,
              attemptId: runtime.activeRun.attemptId,
            }
          : null,
      },
    );
  }
}

function instructionIdsFromChangeRequest(changeRequest) {
  return (changeRequest?.requirements?.instructions ?? [])
    .map((instruction) => instruction?.instructionId)
    .filter((value) => typeof value === "string");
}

async function validateAttemptSupplement(
  context,
  {
    requestId,
    attemptId,
    attemptRoot,
    changeRequest = null,
    requireSealed = true,
  },
) {
  const request = changeRequest ?? await readLifecycleJson(
    path.join(
      context.projectRoot,
      "requests",
      requestId,
      "change-request.json",
    ),
    "change-request.json",
  );
  return validateUserSupplementArchive({
    attemptRoot,
    expectedIdentity: {
      projectId: context.projectId,
      documentId: context.documentId,
      requestId,
      attemptId,
      instructionIds: instructionIdsFromChangeRequest(request),
    },
    requireSealed,
  });
}

async function refreshIdleSource(context, project, runtime) {
  if (runtime.activeRun || runtime.pendingWrite || runtime.conflict) return;
  const source = await readSourceFile(context.sourcePath);
  if (source.sha256 === project.currentHtmlSha256) return;
  project.currentHtmlSha256 = source.sha256;
  project.currentExactVersionId = await exactVersionForHash(
    context,
    source.sha256,
  );
  project.lastModifiedAt = source.lastModifiedAt;
  await writeProject(context, project);
  await syncCurrentSourceIdentity(context, source);
  runtime.view = {
    viewMode: "current",
    latestVersionId: project.latestVersionId,
    currentBasedOnVersionId: project.currentBasedOnVersionId,
    currentExactVersionId: project.currentExactVersionId,
    viewingVersionId: null,
    renderedContentSha256: source.sha256,
  };
  runtime.autosave = {
    status: "updated",
    expectedSourceSha256: source.sha256,
    lastPersistedAt: nowIso(),
    recoveryLogRelativePath: "recovery/autosave-log.json",
  };
  await writeRuntime(context.projectRoot, runtime);
}

async function listVersions(context) {
  const ids = await listIds(
    path.join(context.projectRoot, "versions"),
    /^ver_\d{4,}$/,
  );
  const versions = [];
  for (const versionId of ids.reverse()) {
    const versionRoot = path.join(context.projectRoot, "versions", versionId);
    const committedPath = path.join(versionRoot, "committed.json");
    if (!(await exists(committedPath))) {
      continue;
    }
    const validated = await validateCommittedVersionRaw(context, versionId);
    const { manifest, annotations } = validated;
    const ordinal = manifest.versionOrdinal;
    let supplements = [];
    let supplementArchive = null;
    let validationReview = null;
    let candidateAssessment = null;
    if (manifest.requestId && manifest.attemptId) {
      const requestRoot = path.join(
        context.projectRoot,
        "requests",
        manifest.requestId,
      );
      const attemptRoot = path.join(
        requestRoot,
        "attempts",
        manifest.attemptId,
      );
      if (await exists(path.join(attemptRoot, "USER_SUPPLEMENT.json"))) {
        const changeRequest = await readLifecycleJson(
          path.join(requestRoot, "change-request.json"),
          "change-request.json",
        );
        supplementArchive = await validateAttemptSupplement(context, {
          requestId: manifest.requestId,
          attemptId: manifest.attemptId,
          attemptRoot,
          changeRequest,
          requireSealed: true,
        });
        supplements = supplementArchive.records;
      }
      const validationReviewPath = path.join(
        attemptRoot,
        "validation-review.json",
      );
      if (await exists(validationReviewPath)) {
        validationReview = await readAuxiliaryJson(
          validationReviewPath,
          "validation-review.json",
        );
      }
      const candidateAssessmentPath = path.join(
        attemptRoot,
        "candidate-assessment.json",
      );
      if (await exists(candidateAssessmentPath)) {
        candidateAssessment = await readCandidateAssessment(
          candidateAssessmentPath,
          {
            projectId: context.projectId,
            documentId: context.documentId,
            requestId: manifest.requestId,
            attemptId: manifest.attemptId,
            candidateVersionId: versionId,
          },
          { verifyHistoricalEvidence: true },
        );
      }
    }
    versions.push({
      id: versionId,
      versionId,
      versionOrdinal: ordinal,
      versionLabel: manifest.versionLabel,
      displayVersionLabel: userVersionLabel(ordinal),
      label: manifest.versionLabel,
      summary: manifest.summary ?? "",
      generatedAt: manifest.generatedAt,
      createdAt: manifest.generatedAt,
      sourceType: manifest.sourceType,
      previousVersionId: manifest.previousVersionId ?? null,
      basedOnVersionId: manifest.basedOnVersionId ?? null,
      requestId: manifest.requestId ?? null,
      attemptId: manifest.attemptId ?? null,
      contentSha256: manifest.contentSha256,
      versionEntryRelativePath:
        `projects/${context.storageDirectoryName}/versions/${versionId}/files/index.html`,
      versionEntryPath: validated.entryPath,
      ...(annotations ? { annotations } : {}),
      ...(supplementArchive
        ? {
            supplements,
            supplementArchive: {
              status: supplementArchive.status,
              sealedAt: supplementArchive.sealedAt,
              recordsSha256: supplementArchive.recordsSha256,
              attachmentsSha256: supplementArchive.attachmentsSha256,
              recordCount: supplementArchive.recordCount,
              activeRequirementCount:
                supplementArchive.activeRequirementCount,
            },
          }
        : {}),
      ...(validationReview ? { validationReview } : {}),
      ...(candidateAssessment ? { candidateAssessment } : {}),
      manifest,
    });
  }
  return versions;
}

async function latestTerminalRunOutcome(context) {
  const requestIds = await listIds(
    path.join(context.projectRoot, "requests"),
    /^req_\d{4,}$/,
  );
  const requestId = requestIds.at(-1);
  if (!requestId) return null;
  const requestRoot = path.join(context.projectRoot, "requests", requestId);
  const outcomePath = path.join(requestRoot, "outcome.json");
  if (!(await exists(outcomePath))) return null;
  const outcome = await readAuxiliaryJson(outcomePath, "outcome.json");
  if (!["failed", "no-change"].includes(outcome.status)) return null;
  if (
    outcome.projectId !== context.projectId
    || outcome.documentId !== context.documentId
    || outcome.requestId !== requestId
  ) {
    throw new HttpError(
      409,
      "OUTCOME_IDENTITY_MISMATCH",
      "The latest Attempt outcome does not match its project identity.",
    );
  }
  const changeRequest = await readLifecycleJson(
    path.join(requestRoot, "change-request.json"),
    "change-request.json",
  );
  const attemptId = outcome.attemptId;
  const attemptRoot = path.join(requestRoot, "attempts", attemptId);
  const assessmentPath = path.join(
    attemptRoot,
    "candidate-assessment.json",
  );
  const candidateAssessment = await exists(assessmentPath)
    ? await readCandidateAssessment(
        assessmentPath,
        {
          projectId: context.projectId,
          documentId: context.documentId,
          requestId,
          attemptId,
          candidateVersionId: outcome.candidateVersionId,
          baseSha256: outcome.baseSnapshotSha256,
        },
        { verifyHistoricalEvidence: true },
      )
    : null;
  return {
    projectId: context.projectId,
    documentId: context.documentId,
    requestId,
    attemptId,
    status: outcome.status === "failed" ? "error" : "no-change",
    sourcePath: context.sourcePath,
    requestPath: requestRoot,
    attemptPath: attemptRoot,
    baseSnapshotSha256: outcome.baseSnapshotSha256,
    previousVersionId: outcome.previousVersionId,
    basedOnVersionId: outcome.basedOnVersionId,
    freezeCutoffRevision: changeRequest.freezeCutoffRevision,
    candidateVersionId: outcome.candidateVersionId,
    candidateVersionOrdinal: outcome.candidateVersionOrdinal,
    candidateVersionLabel: outcome.candidateVersionLabel,
    submittedAt: changeRequest.createdAt,
    summary: changeRequest.requirements?.summary ?? "",
    commentCount: outcome.annotationArchive?.commentCount ?? 0,
    changeEventCount: outcome.annotationArchive?.editEventCount ?? 0,
    completionObserved: await exists(path.join(attemptRoot, "completion.json")),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(candidateAssessment ? { candidateAssessment } : {}),
  };
}

function recoveryIdentityFor(context, project, runtime, sourceSha256) {
  const identity = {
    schemaVersion: "1.0.0",
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
    basedOnVersionId: project.currentBasedOnVersionId,
    sourceSha256,
    editRevision: runtime.lastPersistedRevision,
  };
  return {
    ...identity,
    token: sha256(Buffer.from(jsonText(identity), "utf8")),
  };
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

async function workspaceState(sourcePath, { projectStorageVersion = "" } = {}) {
  const projectFileState = await projectFileWorkspaceState(sourcePath);
  if (projectFileState) return projectFileState;
  // A v4 client never opens or migrates an older workspace. Its only
  // admissible existing state is a valid Project File; every other HTML is
  // deliberately presented as an external source for a fresh V1 import.
  if (projectStorageVersion === "4.0.0") {
    return unmanagedWorkspaceState(sourcePath);
  }
  let context;
  try {
    context = await loadContextBySource(sourcePath, false);
  } catch (error) {
    if (error?.code !== "PROJECT_NOT_FOUND") throw error;
    return unmanagedWorkspaceState(sourcePath);
  }
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    await recoverSubmittingRequestRaw(context);
    await recoverTransactionsRaw(context);
    const project = await readProject(context);
    let runtime = await readRuntime(context, { hydrateArtifacts: false });
    await refreshIdleSource(context, project, runtime);
    const refreshedProject = await readProject(context);
    const refreshedRuntime = await readRuntime(context);
    const currentSource = await readSourceFile(context.sourcePath);
    const sourceHistory = await readSourceHistory(
      context,
      currentSource.sha256,
    );
    const currentExactVersionId =
      currentSource.sha256 === refreshedProject.currentHtmlSha256
        ? refreshedProject.currentExactVersionId
        : await exactVersionForHash(context, currentSource.sha256);
    const versions = await listVersions(context);
    const recentRunOutcome = refreshedRuntime.activeRun
      ? null
      : await latestTerminalRunOutcome(context);
    const recoveryIdentity = recoveryIdentityFor(
      context,
      refreshedProject,
      refreshedRuntime,
      currentSource.sha256,
    );
  return {
      ok: true,
      registered: true,
      workspace: WORKSPACE_ROOT,
      projectRoot: context.projectRoot,
      paths: {
        currentHtml: context.sourcePath,
        projectRecords: context.projectRoot,
      },
      projectId: context.projectId,
      documentId: context.documentId,
      sourcePath: context.sourcePath,
      currentHtmlSha256: currentSource.sha256,
      sourceSha256: currentSource.sha256,
      lastModifiedAt: currentSource.lastModifiedAt,
      latestVersionId: refreshedProject.latestVersionId,
      currentBasedOnVersionId: refreshedProject.currentBasedOnVersionId,
      currentExactVersionId,
      restoredFromVersionId:
        refreshedProject.restoredFromVersionId ?? null,
      project: refreshedProject,
      runtimeState: {
        ...refreshedRuntime,
        conflict: refreshedRuntime.conflict ?? null,
      },
      activeRun: refreshedRuntime.activeRun,
      recentRunOutcome,
      activeDraft: refreshedRuntime.draft,
      recoveryIdentity,
      sourceHistory: sourceHistoryResponse(sourceHistory),
      versions,
      current: {
        path: context.sourcePath,
        entryPath: context.sourcePath,
        sha256: currentSource.sha256,
      },
    };
  });
}

async function ensureProject(body) {
  if (body.projectStorageVersion === "4.0.0") {
    return ensureProjectFile(body);
  }
  const existingProjectFile = await projectFileWorkspaceForSource(body.sourcePath);
  if (existingProjectFile) return ensureProjectFile(body);
  const expectedSourceSha256 = requireSha256(
    body.expectedSourceSha256,
    "expectedSourceSha256",
  );
  const context = await loadContextBySource(
    body.sourcePath,
    true,
    { expectedSourceSha256 },
  );
  const source = await readSourceFile(context.sourcePath);
  const state = await workspaceState(context.sourcePath);
  return {
    ...state,
    content: source.html,
  };
}

async function saveAutosave(body) {
  const projectFileSave = await saveProjectFileAutosave(body);
  if (projectFileSave) return projectFileSave;
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  const rawHtml = body.html ?? body.baseHtml;
  requireCompleteHtml(rawHtml, "autosave html");
  const html = rawHtml;
  const editRevision = Number(body.editRevision);
  if (!Number.isSafeInteger(editRevision) || editRevision < 1) {
    throw new HttpError(
      400,
      "INVALID_EDIT_REVISION",
      "editRevision must be a positive integer.",
    );
  }
  const expectedSourceSha256 = requireSha256(
    body.expectedSourceSha256 ?? body.sourceSha256,
    "expectedSourceSha256",
  );

  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    await recoverTransactionsRaw(context);
    const project = await readProject(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
    const source = await readSourceFile(context.sourcePath);
    const targetBuffer = Buffer.from(html, "utf8");
    const targetSha256 = sha256(targetBuffer);
    const currentSourceHistory = await readSourceHistory(
      context,
      source.sha256,
    );
    if (editRevision <= runtime.lastPersistedRevision) {
      return {
        ok: true,
        status: "stale-revision-ignored",
        skipped: true,
        projectId: context.projectId,
        documentId: context.documentId,
        editRevision,
        persistedRevision: runtime.lastPersistedRevision,
        lastPersistedRevision: runtime.lastPersistedRevision,
        currentHtmlSha256: source.sha256,
        sourceSha256: source.sha256,
        sha256: source.sha256,
        content: source.html,
        lastModifiedAt: source.lastModifiedAt,
        sourceHistory: sourceHistoryResponse(currentSourceHistory),
        versionCreated: false,
      };
    }
    if (source.sha256 !== expectedSourceSha256) {
      const conflictId = `conflict_${randomUUID()}`;
      const recoveryRoot = path.join(context.projectRoot, "recovery", conflictId);
      await ensureDirectory(recoveryRoot);
      await atomicWriteFile(
        path.join(recoveryRoot, "editor-candidate.html"),
        targetBuffer,
      );
      runtime.conflict = {
        conflictId,
        type: "autosave-source",
        expectedSourceSha256,
        externalSourceSha256: source.sha256,
        candidateContentSha256: targetSha256,
        candidateRecoveryRelativePath:
          `recovery/${conflictId}/editor-candidate.html`,
        editRevision,
        detectedAt: nowIso(),
      };
      runtime.lifecycleState = "awaiting-conflict-resolution";
      runtime.lastWriteError = {
        code: "SOURCE_HASH_CONFLICT",
        message:
          "The source changed outside the workbench and was not overwritten.",
        at: nowIso(),
      };
      runtime.autosave = {
        status: "external-conflict",
        expectedSourceSha256,
        recoveryLogRelativePath: "recovery/autosave-log.json",
        errorCode: "SOURCE_HASH_CONFLICT",
        errorMessage: runtime.lastWriteError.message,
      };
      await writeRuntime(context.projectRoot, runtime);
      throw new HttpError(
        409,
        "SOURCE_CHANGED",
        "The source HTML changed outside the workbench and was not overwritten.",
        runtime.conflict,
      );
    }
    const nextSourceHistory = prepareAutosaveSourceHistory(
      currentSourceHistory,
      body.sourceHistoryOperations,
      {
        context,
        sourceHtml: source.html,
        sourceSha256: source.sha256,
        targetHtml: html,
        targetSourceSha256: targetSha256,
      },
    );
    const rawEvents =
      Array.isArray(body.changeEvents) && body.changeEvents.length > 0
        ? body.changeEvents
        : [
            {
              eventId: `edit_${editRevision}`,
              kind: "document",
              before: { sha256: source.sha256 },
              after: { sha256: targetSha256 },
              summary: "自动写回当前 HTML",
            },
          ];
    const auditEvents = rawEvents.map((event) =>
      sourceTransactionAuditEvent(context, project, editRevision, event)
    );
    const { source: written } = await commitSourceTransaction({
      kind: "autosave",
      context,
      project,
      runtime,
      source,
      editRevision,
      expectedSourceSha256,
      targetBuffer,
      nextSourceHistory,
      auditEvents,
      recoveryId: `write_${editRevision}_${randomUUID()}`,
      revisionMode: "max",
      skipSourceReplacementWhenTargetMatches: true,
      adapters: sourceTransactionAdapters(),
    });
    return {
      ok: true,
      status: "source-updated",
      projectId: context.projectId,
      documentId: context.documentId,
      editRevision,
      persistedRevision: runtime.lastPersistedRevision,
      lastPersistedRevision: runtime.lastPersistedRevision,
      currentHtmlSha256: written.sha256,
      sourceSha256: written.sha256,
      sha256: written.sha256,
      content: written.html,
      lastModifiedAt: written.lastModifiedAt,
      currentBasedOnVersionId: project.currentBasedOnVersionId,
      currentExactVersionId: project.currentExactVersionId,
      recoveryIdentity: recoveryIdentityFor(
        context,
        project,
        runtime,
        written.sha256,
      ),
      sourceHistory: sourceHistoryResponse(nextSourceHistory),
      versionCreated: false,
    };
  });
}
async function runSourceHistoryAction(body) {
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  const expectedSourceSha256 = requireSha256(
    body.expectedSourceSha256,
    "expectedSourceSha256",
  );

  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    await recoverTransactionsRaw(context);
    const project = await readProject(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
    const source = await readSourceFile(context.sourcePath);
    const currentSourceHistory = await readSourceHistory(
      context,
      source.sha256,
    );
    const actionWasApplied = currentSourceHistory.appliedActions.some(
      (action) => action.actionId === body.actionId,
    );
    if (source.sha256 !== expectedSourceSha256 && !actionWasApplied) {
      throw new HttpError(
        409,
        "SOURCE_CHANGED",
        "The source HTML changed before the history action.",
        {
          expectedSourceSha256,
          actualSourceSha256: source.sha256,
        },
      );
    }
    const action = applySourceHistoryCommand(
      currentSourceHistory,
      source.html,
      body,
      context,
    );
    if (!action.changed) {
      return {
        ok: true,
        status: action.replayed ? "history-action-replayed" : "history-no-op",
        replayed: action.replayed,
        projectId: context.projectId,
        documentId: context.documentId,
        persistedRevision: runtime.lastPersistedRevision,
        lastPersistedRevision: runtime.lastPersistedRevision,
        currentHtmlSha256: source.sha256,
        sourceSha256: source.sha256,
        sha256: source.sha256,
        content: source.html,
        lastModifiedAt: source.lastModifiedAt,
        sourceHistory: sourceHistoryResponse(action.history),
        target: action.target,
        selection: action.selection,
        targetTransition: action.targetTransition,
        versionCreated: false,
      };
    }

    const editRevision = Math.max(
      runtime.editRevision,
      runtime.lastPersistedRevision,
    ) + 1;
    const targetBuffer = Buffer.from(action.html, "utf8");
    const directionLabel = body.direction === "undo" ? "撤销" : "重做";
    const auditEvent = sourceTransactionAuditEvent(
      context,
      project,
      editRevision,
      {
        eventId: `history_${body.actionId}`,
        kind: action.entry?.kind || "document",
        property: action.entry?.property,
        target: action.target,
        before: { sha256: source.sha256 },
        after: { sha256: action.sourceSha256 },
        summary: `${directionLabel}画布源码操作`,
        historyAction: {
          actionId: body.actionId,
          direction: body.direction,
          operationId: action.entry?.operationId || null,
        },
      },
    );
    const { source: written } = await commitSourceTransaction({
      kind: "history",
      context,
      project,
      runtime,
      source,
      editRevision,
      expectedSourceSha256: source.sha256,
      targetBuffer,
      nextSourceHistory: action.history,
      auditEvents: [auditEvent],
      recoveryId: `history_${editRevision}_${randomUUID()}`,
      revisionMode: "set",
      adapters: sourceTransactionAdapters(),
    });
    return {
      ok: true,
      status: "history-source-updated",
      replayed: false,
      projectId: context.projectId,
      documentId: context.documentId,
      editRevision,
      persistedRevision: editRevision,
      lastPersistedRevision: editRevision,
      currentHtmlSha256: written.sha256,
      sourceSha256: written.sha256,
      sha256: written.sha256,
      content: written.html,
      lastModifiedAt: written.lastModifiedAt,
      currentBasedOnVersionId: project.currentBasedOnVersionId,
      currentExactVersionId: project.currentExactVersionId,
      recoveryIdentity: recoveryIdentityFor(
        context,
        project,
        runtime,
        written.sha256,
      ),
      sourceHistory: sourceHistoryResponse(action.history),
      target: action.target,
      selection: action.selection,
      targetTransition: action.targetTransition,
      operationId: action.entry?.operationId || null,
      versionCreated: false,
    };
  });
}
function mergeRecords(existing, incoming, idKeys) {
  const result = [];
  const byId = new Map();
  for (const value of [...existing, ...incoming]) {
    if (!value || typeof value !== "object") continue;
    const id = idKeys
      .map((key) => cleanText(value[key], 180))
      .find(Boolean) ?? randomUUID();
    byId.set(id, { ...value });
  }
  result.push(...byId.values());
  return result;
}

function schemaRecordId(prefix, value, fallback) {
  const cleaned = String(value ?? fallback)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(new RegExp(`^${prefix}_?`), "");
  return `${prefix}_${cleaned || randomUUID().replaceAll("-", "")}`;
}

function normalizedTarget(rawTarget, index, { requireResolved = true } = {}) {
  if (
    !rawTarget
    || typeof rawTarget !== "object"
    || Array.isArray(rawTarget)
  ) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef at index ${index} must be an object.`,
    );
  }
  const target = rawTarget;
  const allowedFields = new Set([
    "targetId",
    "label",
    "level",
    "selector",
    "textQuote",
    "sourceAnchor",
    "fingerprint",
    "resolution",
  ]);
  const unknownFields = Object.keys(target).filter(
    (field) => !allowedFields.has(field),
  );
  if (unknownFields.length > 0) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef at index ${index} contains unsupported fields.`,
      { unknownFields },
    );
  }
  const targetId = cleanText(target.targetId, 180);
  const label = cleanText(target.label, 500);
  if (!/^target_[A-Za-z0-9_-]+$/.test(targetId)) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef at index ${index} has an invalid targetId.`,
    );
  }
  if (!label) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef ${targetId} is missing label.`,
    );
  }
  if (
    !["module", "subregion", "text", "insertion-point"].includes(target.level)
  ) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef ${targetId} has an invalid level.`,
    );
  }
  const allowedResolutions = ["exact", "rebound", "ambiguous", "orphaned"];
  if (!requireResolved && !allowedResolutions.includes(target.resolution)) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef ${targetId} has an invalid resolution.`,
      { resolution: target.resolution ?? null },
    );
  }
  if (requireResolved && !["exact", "rebound"].includes(target.resolution)) {
    throw new HttpError(
      422,
      "TARGET_UNRESOLVED",
      `TargetRef ${targetId} must resolve as exact or rebound before submission.`,
      { resolution: target.resolution ?? null },
    );
  }
  const normalized = {
    targetId,
    label,
    level: target.level,
  };
  if (cleanText(target.selector, 4000)) {
    normalized.selector = cleanText(target.selector, 4000);
  }
  if (cleanText(target.textQuote, 5000)) {
    normalized.textQuote = cleanText(target.textQuote, 5000);
  }
  if (target.sourceAnchor !== undefined) {
    if (
      !target.sourceAnchor
      || typeof target.sourceAnchor !== "object"
      || Array.isArray(target.sourceAnchor)
      || Object.keys(target.sourceAnchor).some(
        (field) =>
          !["startOffset", "endOffset", "sourceSha256"].includes(field),
      )
      || !Number.isSafeInteger(target.sourceAnchor.startOffset)
      || !Number.isSafeInteger(target.sourceAnchor.endOffset)
      || target.sourceAnchor.startOffset < 0
      || target.sourceAnchor.endOffset < target.sourceAnchor.startOffset
      || !/^sha256:[a-f0-9]{64}$/.test(
        target.sourceAnchor.sourceSha256 ?? "",
      )
    ) {
      throw new HttpError(
        422,
        "INVALID_TARGET_REF",
        `TargetRef ${targetId} has an invalid sourceAnchor.`,
      );
    }
    normalized.sourceAnchor = {
      startOffset: target.sourceAnchor.startOffset,
      endOffset: target.sourceAnchor.endOffset,
      sourceSha256: target.sourceAnchor.sourceSha256,
    };
  }
  if (target.fingerprint !== undefined) {
    const fingerprint = target.fingerprint;
    const stableAttributes =
      fingerprint
      && typeof fingerprint.stableAttributes === "object"
      && !Array.isArray(fingerprint.stableAttributes)
        ? fingerprint.stableAttributes
        : null;
    const ancestorFingerprint = fingerprint?.ancestorFingerprint;
    const tagName = cleanText(fingerprint?.tagName, 200).toLowerCase();
    if (
      !fingerprint
      || typeof fingerprint !== "object"
      || Array.isArray(fingerprint)
      || Object.keys(fingerprint).some(
        (field) =>
          ![
            "tagName",
            "stableAttributes",
            "ancestorFingerprint",
            "textPrefix",
            "textSuffix",
          ].includes(field),
      )
      || !/^[a-z][a-z0-9:-]*$/.test(tagName)
      || !stableAttributes
      || Object.keys(stableAttributes).length > 32
      || Object.entries(stableAttributes).some(
        ([name, value]) =>
          !cleanText(name, 200)
          || typeof value !== "string"
          || value.length > 4000,
      )
      || !Array.isArray(ancestorFingerprint)
      || ancestorFingerprint.length > 32
      || ancestorFingerprint.some(
        (value) => typeof value !== "string" || value.length > 4000,
      )
    ) {
      throw new HttpError(
        422,
        "INVALID_TARGET_REF",
        `TargetRef ${targetId} has an invalid fingerprint.`,
      );
    }
    normalized.fingerprint = {
      tagName,
      stableAttributes: Object.fromEntries(
        Object.entries(stableAttributes).map(([name, value]) => [
          cleanText(name, 200).toLowerCase(),
          value,
        ]),
      ),
      ancestorFingerprint: [...ancestorFingerprint],
      ...(cleanText(fingerprint.textPrefix, 500)
        ? { textPrefix: cleanText(fingerprint.textPrefix, 500) }
        : {}),
      ...(cleanText(fingerprint.textSuffix, 500)
        ? { textSuffix: cleanText(fingerprint.textSuffix, 500) }
        : {}),
    };
  }
  if (
    !normalized.selector
    && !normalized.sourceAnchor
    && !normalized.fingerprint
  ) {
    throw new HttpError(
      422,
      "INVALID_TARGET_REF",
      `TargetRef ${targetId} must include selector, sourceAnchor, or fingerprint.`,
    );
  }
  normalized.resolution = target.resolution;
  return normalized;
}

function executionTarget(target) {
  const compact = { ...target };
  if (
    compact.level === "module"
    && typeof compact.textQuote === "string"
    && compact.textQuote.length > MAX_EXECUTION_MODULE_TEXT_QUOTE_CHARS
  ) {
    // The immutable annotation archive retains the complete captured quote.
    // For execution, a module already has selector/source-anchor/fingerprint
    // identity, so repeating thousands of characters only consumes AI context.
    delete compact.textQuote;
  }
  return compact;
}

function normalizeFrozenComments(
  comments,
  frozenAt,
  revision,
  attachmentsByComment = new Map(),
) {
  return comments.map((comment, index) => {
    const commentId = schemaRecordId(
      "comment",
      comment.commentId ?? comment.id,
      String(index + 1),
    );
    const attachments = attachmentsByComment.get(commentId) ?? [];
    return {
      commentId,
      createdAt: comment.createdAt ?? frozenAt,
      updatedAt: comment.updatedAt ?? frozenAt,
      capturedRevision:
        Number.isSafeInteger(comment.capturedRevision)
          ? comment.capturedRevision
          : revision,
      text:
        cleanText(comment.text ?? comment.content, 20_000)
        || (attachments.length > 0 ? "请参考本条评论所附附件。" : "待处理评论"),
      ...(attachments.length > 0 ? { attachments } : {}),
      target: normalizedTarget(comment.target, index),
      persistence:
        comment.persistence === "project-rule"
          ? "project-rule"
          : "request-only",
    };
  });
}

async function collectRequestAttachments(context, comments, requestId) {
  const byComment = new Map();
  const files = [];
  const seenAttachmentIds = new Set();
  let totalByteLength = 0;
  for (const [commentIndex, comment] of comments.entries()) {
    const commentId = schemaRecordId(
      "comment",
      comment.commentId ?? comment.id,
      String(commentIndex + 1),
    );
    const rawAttachments = Array.isArray(comment.attachments)
      ? comment.attachments
      : [];
    if (rawAttachments.length > MAX_ATTACHMENTS_PER_COMMENT) {
      throw new HttpError(
        422,
        "TOO_MANY_ATTACHMENTS",
        `A comment may include at most ${MAX_ATTACHMENTS_PER_COMMENT} attachments.`,
      );
    }
    const frozenAttachments = [];
    for (const [attachmentIndex, raw] of rawAttachments.entries()) {
      const attachment = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
      const attachmentId = schemaRecordId(
        "attachment",
        attachment.attachmentId ?? attachment.id,
        `${commentIndex + 1}_${attachmentIndex + 1}`,
      );
      if (seenAttachmentIds.has(attachmentId)) {
        throw new HttpError(
          422,
          "DUPLICATE_ATTACHMENT_ID",
          "Every attachment in a Request must have a unique attachmentId.",
        );
      }
      seenAttachmentIds.add(attachmentId);
      const fileName = safeAttachmentFileName(attachment.fileName ?? attachment.name);
      const mediaType = attachmentMediaType(attachment.mediaType ?? attachment.type);
      const sourcePath = resolveAttachmentPath(
        context,
        attachment.relativePath,
      );
      const information = await lstat(sourcePath.absolutePath).catch((error) => {
        if (error?.code === "ENOENT") {
          throw new HttpError(
            422,
            "ATTACHMENT_NOT_FOUND",
            `Attachment ${attachmentId} is missing from the project.`,
          );
        }
        throw error;
      });
      if (
        !information.isFile()
        || information.isSymbolicLink()
        || information.size <= 0
        || information.size > MAX_ATTACHMENT_BYTES
      ) {
        throw new HttpError(
          422,
          "INVALID_ATTACHMENT_FILE",
          `Attachment ${attachmentId} is not a safe project file.`,
        );
      }
      const buffer = await readFile(sourcePath.absolutePath);
      const actualSha256 = sha256(buffer);
      if (
        attachment.sha256 && attachment.sha256 !== actualSha256
        || attachment.byteLength !== undefined
          && Number(attachment.byteLength) !== buffer.byteLength
      ) {
        throw new HttpError(
          409,
          "ATTACHMENT_CHANGED",
          `Attachment ${attachmentId} changed after it was added to the comment.`,
        );
      }
      totalByteLength += buffer.byteLength;
      if (totalByteLength > MAX_REQUEST_ATTACHMENT_BYTES) {
        throw new HttpError(
          413,
          "REQUEST_ATTACHMENTS_TOO_LARGE",
          `Request attachments cannot exceed ${MAX_REQUEST_ATTACHMENT_BYTES} bytes in total.`,
        );
      }
      const requestRelativePath = [
        "input",
        "attachments",
        commentId,
        `${attachmentId}-${fileName}`,
      ].join("/");
      const relativePath = `requests/${requestId}/${requestRelativePath}`;
      const normalized = {
        attachmentId,
        kind: attachmentKind(attachment.kind, mediaType, fileName),
        fileName,
        mediaType,
        byteLength: buffer.byteLength,
        sha256: actualSha256,
        relativePath,
        requestRelativePath,
        source: attachment.source === "clipboard" ? "clipboard" : "file-picker",
      };
      frozenAttachments.push(normalized);
      files.push({
        ...normalized,
        commentId,
        sourceAbsolutePath: sourcePath.absolutePath,
      });
    }
    if (frozenAttachments.length > 0) byComment.set(commentId, frozenAttachments);
  }
  return { byComment, files, totalByteLength };
}

function normalizeFrozenEditEvents(events, frozenAt, revision, basedOnVersionId) {
  return events.map((event, index) => {
    let identity;
    try {
      identity = decodeDirectEditIdentity(event, {
        fallbackBasedOnVersionId: basedOnVersionId,
        fallbackRevision: Math.max(1, revision),
        allowUnassignedRevision: true,
        label: `Draft direct edit ${index + 1}`,
      });
    } catch (error) {
      if (error instanceof DirectEditCompatibilityError) {
        throw new HttpError(422, error.code, error.message);
      }
      throw error;
    }
    return {
      eventId: schemaRecordId(
        "edit",
        event.eventId ?? event.id,
        String(index + 1),
      ),
      createdAt: event.createdAt ?? frozenAt,
      revision: identity.revision,
      basedOnVersionId: identity.basedOnVersionId,
      kind: ["text", "style", "reorder", "structure"].includes(event.kind)
        ? event.kind
        : "structure",
      ...(cleanText(event.property, 300)
        ? { property: cleanText(event.property, 300) }
        : {}),
      summary:
        cleanText(event.summary, 5000)
        || "提交前已自动写回的本地编辑",
      // Direct edits are immutable audit evidence, not authorization for the AI
      // to change that target again. Their historical target may legitimately be
      // ambiguous or orphaned after a later edit and must not block submission.
      target: normalizedTarget(event.target, index, { requireResolved: false }),
      before: event.before ?? null,
      after: event.after ?? null,
    };
  });
}

async function saveDraft(body) {
  const projectFileDraft = await saveProjectFileDraft(body);
  if (projectFileDraft) return projectFileDraft;
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
    const command = applyDraftCommand(runtime.draft, body, {
      randomUUID,
      now: nowIso,
    });
    if (command.replayed) {
      return {
        ok: true,
        replayed: true,
        operationId: command.operationId,
        projectId: context.projectId,
        documentId: context.documentId,
        activeDraft: command.current,
      };
    }
    const nextDraft = command.next;
    const draftContent = draftArtifactRecord(nextDraft);
    const draftText = jsonText(draftContent);
    await atomicWriteFile(
      path.join(context.projectRoot, "draft", "annotations.json"),
      draftText,
    );
    await maybeFailpoint(
      "after-draft-artifact-written",
      path.join(context.projectRoot, "draft"),
    );
    runtime.draft = {
      annotationsRelativePath: "draft/annotations.json",
      annotationsSha256: sha256(draftText),
      commentIds: nextDraft.comments
        .map((item, index) =>
          schemaRecordId(
            "comment",
            item.commentId ?? item.id,
            String(index + 1),
          )
        ),
      editEventIds: nextDraft.changeEvents
        .map((item, index) =>
          schemaRecordId(
            "edit",
            item.eventId ?? item.id,
            String(index + 1),
          )
        ),
      draftRevision: nextDraft.draftRevision,
      updatedAt: nextDraft.updatedAt,
      comments: nextDraft.comments,
      changeEvents: nextDraft.changeEvents,
      deletedCommentIds: nextDraft.deletedCommentIds,
      appliedOperationIds: nextDraft.appliedOperationIds,
    };
    await writeRuntime(context.projectRoot, runtime);
    return {
      ok: true,
      replayed: false,
      operationId: command.operationId,
      projectId: context.projectId,
      documentId: context.documentId,
      activeDraft: activeDraftSnapshot(runtime.draft, nowIso),
    };
  });
}

async function saveDraftAttachment(body) {
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
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
      context,
      relativePath,
      { draftOnly: true },
    );
    await ensureDirectory(path.dirname(absolutePath));
    await atomicWriteFile(absolutePath, buffer);
    return {
      ok: true,
      projectId: context.projectId,
      documentId: context.documentId,
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
  });
}

async function readAttachment(sourcePath, relativePath) {
  const context = await loadContextBySource(sourcePath, false);
  const resolved = resolveAttachmentPath(context, relativePath);
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
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
    const relativePath = String(body.relativePath ?? "").replaceAll("\\", "/");
    if (!relativePath.startsWith("draft/attachments/")) {
      return { ok: true, removed: false, retainedImmutableCopy: true };
    }
    const resolved = resolveAttachmentPath(
      context,
      relativePath,
      { draftOnly: true },
    );
    await rm(resolved.absolutePath, { force: true });
    await rm(path.dirname(resolved.absolutePath)).catch(() => {});
    return { ok: true, removed: true };
  });
}

function managedAiRules() {
  return `# PageRoot 通用执行规则

## 修改范围

- 只执行 PROMPT.md 标识的当前 Request / Attempt。
- 只修改用户明确要求的区域和为完成要求必需的关联内容；不要顺手重构、美化或修复其他区域。
- 默认保持目标外内容不变（preserveOutsideTargets=true）。

## 文件边界

- 冻结输入和用户源 HTML 都是只读的。严格按 input-manifest.json 的 readOrder 读取冻结输入；当前 Attempt 的受控 USER_SUPPLEMENT.json，以及其中尚未撤销的受控补充所引用的 supplement-attachments/ 附件，是 readOrder 之外唯一可读取的内容。不得扫描其他任务、版本、项目目录或用户文件。
- 只读取 PROMPT.md 列出的项目受管附件，以及 USER_SUPPLEMENT.json 中当前有效补充所引用的当前 Attempt 附件；不得追溯用户的外部原文件，也不得伪造附件路径、字节数或 SHA-256。
- 只把一个完整 HTML 写入 PROMPT.md 的“唯一 HTML 输出”绝对路径。输出文件名已经固定，不得自行计算、改名或写入 input/base/index.html、output/index.html 等其他路径。
- 不得修改 PROJECT.md、USER_SUPPLEMENT.json、冻结输入或协议文件。

## 完成

- 不得手写 completion.json；只有 finalizer 生成的有效 completion.json 才表示完成。
- finalizer 返回 \`status=cancelled\` 时立即停止，不要重试或写入其他路径。
`;
}

function shellQuoted(value) {
  return JSON.stringify(String(value));
}

function finalizerCommandForRun(context, activeRun) {
  const nodeRuntime = process.versions.electron
    ? `ELECTRON_RUN_AS_NODE=1 ${shellQuoted(process.execPath)}`
    : shellQuoted(process.execPath);
  return [
    nodeRuntime,
    shellQuoted(FINALIZER_PATH),
    "--workspace",
    shellQuoted(WORKSPACE_ROOT),
    "--project-id",
    shellQuoted(context.projectId),
    "--request-id",
    shellQuoted(activeRun.requestId),
    "--attempt-id",
    shellQuoted(activeRun.attemptId),
  ].join(" ");
}

function supplementCommandForRun(context, activeRun) {
  const nodeRuntime = process.versions.electron
    ? `ELECTRON_RUN_AS_NODE=1 ${shellQuoted(process.execPath)}`
    : shellQuoted(process.execPath);
  return [
    nodeRuntime,
    shellQuoted(RECORD_SUPPLEMENT_PATH),
    "--workspace",
    shellQuoted(WORKSPACE_ROOT),
    "--project-id",
    shellQuoted(context.projectId),
    "--request-id",
    shellQuoted(activeRun.requestId),
    "--attempt-id",
    shellQuoted(activeRun.attemptId),
  ].join(" ");
}

function promptForRun(
  context,
  project,
  activeRun,
  requestRoot,
  attemptRoot,
) {
  const command = finalizerCommandForRun(context, activeRun);
  const supplementCommand = supplementCommandForRun(context, activeRun);
  const output = attemptOutputDescriptor(
    project.displayName,
    activeRun.candidateVersionOrdinal,
  );
  const outputPath = path.join(
    attemptRoot,
    ...output.relativePath.split("/"),
  );
  const attachmentLines = (activeRun.frozenComments ?? []).flatMap(
    (comment) => (comment.attachments ?? []).map((attachment) => [
      `- 附件 ${attachment.attachmentId} · 评论 ${comment.commentId} · 目标 ${comment.target.targetId}`,
      `  - 项目内路径：${JSON.stringify(path.join(requestRoot, attachment.requestRelativePath))}`,
      `  - 相对路径：${JSON.stringify(attachment.requestRelativePath)}`,
      `  - 文件信息：${JSON.stringify(attachment.fileName)} · ${attachment.mediaType} · ${attachment.byteLength} 字节`,
      `  - SHA-256：${attachment.sha256}`,
    ].join("\n")),
  );
  const attachmentSection = attachmentLines.length > 0
    ? `
## 本轮附件

以下文件都是 PageRoot 项目内已经冻结的副本：

${attachmentLines.join("\n")}

若绝对路径因项目整体移动而失效，请以 Request 根目录解析相对路径。
`
    : "";
  return `# PageRoot 本轮修改 · ${project.displayName}

## 本轮身份

- 目标版本：**${userVersionLabel(activeRun.candidateVersionOrdinal)}**
- 项目 / 文档：\`${context.projectId}\` / \`${context.documentId}\`
- Request / Attempt：\`${activeRun.requestId}\` / \`${activeRun.attemptId}\`
- 版本身份：上一版 \`${activeRun.previousVersionId}\` · 基于 \`${activeRun.basedOnVersionId}\` · 候选 \`${activeRun.candidateVersionId}\`（\`${activeRun.candidateVersionLabel}\`）
- 输入文件 / 输出文件：\`${project.displayName}\` / \`${output.fileName}\`

## 执行

1. 从下方“冻结输入清单”开始，严格按其 readOrder 读取本轮输入。
2. 以 change-request.json 的冻结要求和 USER_SUPPLEMENT.json 中尚未撤销的受控补充为本轮有效要求，同时遵守 AI_RULES.md 和 PROJECT.md。
3. change-request.json 已包含评论、目标和附件的完整关系；如有附件，将附件内容与用户原话一起理解。
4. 完成本轮修改后，按“完成”章节结束任务。

## 文件位置

- Request / Attempt 根目录：\`${requestRoot}\` / \`${attemptRoot}\`
- 冻结输入清单：\`${path.join(requestRoot, "input-manifest.json")}\`
- PageRoot 通用规则：\`${path.join(requestRoot, "input", "AI_RULES.md")}\`
- 本轮修改要求：\`${path.join(requestRoot, "change-request.json")}\`
- 项目长期规则：\`${path.join(requestRoot, "input", "PROJECT.md")}\`
- 冻结 HTML：\`${path.join(requestRoot, "input", "base", "index.html")}\`
- 对话补充记录：\`${path.join(attemptRoot, "USER_SUPPLEMENT.json")}\`
- 唯一 HTML 输出：\`${outputPath}\`

## 记录对话补充

用户在当前对话中新增、修订或撤销要求时，先为每条消息运行一次下方命令：

- \`idempotencyKey\` 对同一条消息保持稳定且唯一，\`userText\` 保留用户原话。
- \`action\` 使用 \`add\`、\`amend\` 或 \`retract\`。
- \`add\` 可用 \`refersTo\` 指向它补充的原始 \`instructionId\`；\`amend\` / \`retract\` 必须引用已有的 \`instructionId\` 或 supplement \`recordId\`。
- 能取得原始附件时，在 \`attachments\` 中传入本机普通文件的绝对路径；只能看到附件时，改用 \`evidenceState=description-only\` 和 \`evidenceDescription\`。

示例（替换 JSON 内容）：

\`\`\`sh
${supplementCommand} <<'PAGEROOT_SUPPLEMENT_JSON'
{
  "idempotencyKey": "external-chat-turn-001",
  "action": "add",
  "refersTo": [],
  "userText": "用户在对话中新增要求的原话",
  "targetDescription": "用户描述的修改位置",
  "evidenceState": "text-only",
  "evidenceDescription": null,
  "attachments": []
}
PAGEROOT_SUPPLEMENT_JSON
\`\`\`

命令返回 \`ok=true\` 后，重新读取 USER_SUPPLEMENT.json 并执行该条要求；否则停止该条修改并说明原因。finalizer 完成后，本 Attempt 会封存，之后的新要求必须回到源页开启新一轮。

${attachmentSection}

## 完成

完整写入 \`${output.relativePath}\` 后，执行以下 finalizer 命令：

\`\`\`sh
${command}
\`\`\`

`;
}

async function requestFileRecord(root, relativePath, role, mediaType) {
  const buffer = await readFile(path.join(root, relativePath));
  return {
    path: relativePath.split(path.sep).join("/"),
    role,
    mediaType,
    byteLength: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

async function createRequest(body) {
  const projectFileRequest = await createProjectFileRequest(body);
  if (projectFileRequest) return projectFileRequest;
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    await recoverTransactionsRaw(context);
    const project = await readProject(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
    if (runtime.lastPersistedRevision < runtime.editRevision) {
      throw new HttpError(
        409,
        "AUTOSAVE_NOT_FLUSHED",
        "All edits must be written to the source file before submission.",
      );
    }
    const freezeCutoffRevision = Number(
      body.freezeCutoffRevision ?? runtime.editRevision,
    );
    if (
      !Number.isSafeInteger(freezeCutoffRevision)
      || freezeCutoffRevision < 0
      || runtime.lastPersistedRevision < freezeCutoffRevision
    ) {
      throw new HttpError(
        409,
        "FREEZE_REVISION_NOT_PERSISTED",
        "freezeCutoffRevision has not been fully persisted.",
      );
    }
    const source = await readSourceFile(context.sourcePath);
    const expectedHash =
      body.expectedSourceSha256 ?? body.sourceSha256 ?? project.currentHtmlSha256;
    requireSha256(expectedHash, "expectedSourceSha256");
    if (
      source.sha256 !== expectedHash
      || source.sha256 !== project.currentHtmlSha256
    ) {
      throw new HttpError(
        409,
        "SOURCE_HASH_CONFLICT",
        "The source HTML changed before it could be frozen.",
        {
          expectedSourceSha256: expectedHash,
          projectSourceSha256: project.currentHtmlSha256,
          actualSourceSha256: source.sha256,
        },
      );
    }
    const requestId = await nextRequestId(context.projectRoot);
    const attemptId = "attempt_001";
    const candidate = await nextVersionIdentity(context.projectRoot);
    const output = attemptOutputDescriptor(
      project.displayName,
      candidate.versionOrdinal,
    );
    const requestsRoot = path.join(context.projectRoot, "requests");
    const requestRoot = path.join(requestsRoot, requestId);
    const attemptRoot = path.join(
      requestRoot,
      "attempts",
      attemptId,
    );
    const frozenAt = nowIso();
    const summary =
      cleanText(body.summary ?? body.title, 1000)
      || "根据本轮评论和要求生成新的完整 HTML。";
    // An explicitly supplied request snapshot is the freeze authority. Falling
    // back to the durable draft keeps older callers compatible, but unioning
    // both would resurrect a comment that the user deleted immediately before
    // submission.
    const rawComments = mergeRecords(
      [],
      Array.isArray(body.comments)
        ? body.comments
        : runtime.draft.comments ?? [],
      ["commentId", "id"],
    );
    const rawChangeEvents = mergeRecords(
      [],
      Array.isArray(body.changeEvents)
        ? body.changeEvents
        : runtime.draft.changeEvents ?? [],
      ["eventId", "id"],
    );
    const frozenAttachments = await collectRequestAttachments(
      context,
      rawComments,
      requestId,
    );
    const comments = normalizeFrozenComments(
      rawComments,
      frozenAt,
      freezeCutoffRevision,
      frozenAttachments.byComment,
    );
    const changeEvents = normalizeFrozenEditEvents(
      rawChangeEvents,
      frozenAt,
      freezeCutoffRevision,
      project.currentBasedOnVersionId,
    );
    const activeRun = {
      projectId: context.projectId,
      documentId: context.documentId,
      requestId,
      attemptId,
      status: "submitting",
      sourcePath: context.sourcePath,
      requestPath: requestRoot,
      attemptPath: attemptRoot,
      promptPath: path.join(requestRoot, "PROMPT.md"),
      outputPath: path.join(attemptRoot, ...output.relativePath.split("/")),
      completionPath: path.join(attemptRoot, "completion.json"),
      handoffMessage:
        `请执行 ${requestRoot}/PROMPT.md 中的单轮任务，完成后运行其中的最终化（finalizer）命令。`,
      freezeCutoffRevision,
      baseSnapshotSha256: source.sha256,
      previousVersionId: project.latestVersionId,
      basedOnVersionId: project.currentBasedOnVersionId,
      candidateVersionId: candidate.versionId,
      candidateVersionOrdinal: candidate.versionOrdinal,
      candidateVersionLabel: candidate.versionLabel,
      summary,
      commentCount: comments.length,
      changeEventCount: changeEvents.length,
      frozenComments: comments,
      frozenChangeEvents: changeEvents,
      createdAt: frozenAt,
      updatedAt: frozenAt,
    };
    runtime.lifecycleState = "submitting";
    runtime.activeRun = activeRun;
    runtime.conflict = null;
    await writeRuntime(context.projectRoot, runtime);
    await maybeFailpoint(
      "after-request-intent",
      path.join(context.projectRoot, "recovery"),
    );
    const temporary = path.join(
      requestsRoot,
      `.${requestId}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await ensureDirectory(path.join(temporary, "input", "base"));
      await ensureDirectory(path.join(temporary, "input", "annotations"));
      for (const attachment of frozenAttachments.files) {
        const destinationPath = path.join(
          temporary,
          attachment.requestRelativePath,
        );
        await ensureDirectory(path.dirname(destinationPath));
        await freezeLocalAttachment({
          sourcePath: attachment.sourceAbsolutePath,
          destinationPath,
        });
        await syncDirectory(path.dirname(destinationPath));
      }
      await ensureDirectory(
        path.join(temporary, "attempts", attemptId, "output"),
      );
      const temporaryAttempt = path.join(
        temporary,
        "attempts",
        attemptId,
      );
      await atomicWriteJson(
        path.join(temporaryAttempt, "USER_SUPPLEMENT.json"),
        {
          schemaVersion: "1.0.0",
          status: "active",
          projectId: context.projectId,
          documentId: context.documentId,
          requestId,
          attemptId,
          records: [],
          sealedAt: null,
          recordsSha256: null,
          attachmentsSha256: null,
        },
      );
      const temporaryPrompt = promptForRun(
        context,
        project,
        activeRun,
        requestRoot,
        attemptRoot,
      );
      const rawInstructions = Array.isArray(body.instructions)
        ? body.instructions
        : body.instructions
          ? [body.instructions]
          : [];
      const annotations = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        capturedAt: frozenAt,
        freezeCutoffRevision,
        basedOnVersionId: activeRun.basedOnVersionId,
        baseSnapshotSha256: activeRun.baseSnapshotSha256,
        comments,
        editEvents: changeEvents,
      };
      const annotationText = jsonText(annotations);
      const annotationSha256 = sha256(annotationText);
      if (
        !Array.isArray(body.targets)
        || body.targets.length === 0
      ) {
        throw new HttpError(
          422,
          "TARGET_REFS_REQUIRED",
          "At least one resolved targets TargetRef is required.",
        );
      }
      const targets = body.targets.map(
        (target, index) => executionTarget(normalizedTarget(target, index)),
      );
      const targetRefs = targets.map((target) => target.targetId);
      if (new Set(targetRefs).size !== targetRefs.length) {
        throw new HttpError(
          422,
          "DUPLICATE_TARGET_ID",
          "Every frozen TargetRef must have a unique targetId.",
          { targetIds: targetRefs },
        );
      }
      const requestAttachments = comments.flatMap((comment) => (
        Array.isArray(comment.attachments)
          ? comment.attachments.map((attachment) => ({
              ...attachment,
              commentId: comment.commentId,
              targetRef: comment.target.targetId,
              localPath: path.join(
                requestRoot,
                attachment.requestRelativePath,
              ),
            }))
          : []
      ));
      const attachmentRefs = requestAttachments.map(
        (attachment) => attachment.attachmentId,
      );
      const attachmentInstructions = comments
        .filter(
          (comment) =>
            Array.isArray(comment.attachments)
            && comment.attachments.length > 0,
        )
        .map((comment) => ({
          text: comment.text,
          targetRefs: [comment.target.targetId],
          attachmentRefs: comment.attachments.map(
            (attachment) => attachment.attachmentId,
          ),
        }));
      const instructionSources = rawInstructions.length > 0
        ? rawInstructions
        : attachmentInstructions.length > 0
          ? attachmentInstructions
          : [summary];
      const instructions = (
        instructionSources.length > 0
          ? instructionSources
          : [summary]
      ).map((value, index) => {
        const instruction = typeof value === "string"
          ? { text: value }
          : value ?? {};
        const requestedRefs = Array.isArray(instruction.targetRefs)
          ? instruction.targetRefs
          : [];
        const requestedAttachmentRefs = Array.isArray(instruction.attachmentRefs)
          ? instruction.attachmentRefs
          : [];
        if (
          requestedRefs.some(
            (item) =>
              typeof item !== "string"
              || !targetRefs.includes(item),
          )
        ) {
          throw new HttpError(
            422,
            "TARGET_REF_NOT_FOUND",
            "An instruction references a target that is not frozen.",
            { targetRefs: requestedRefs },
          );
        }
        if (
          requestedAttachmentRefs.some(
            (item) =>
              typeof item !== "string"
              || !attachmentRefs.includes(item),
          )
        ) {
          throw new HttpError(
            422,
            "ATTACHMENT_REF_NOT_FOUND",
            "An instruction references an attachment that is not frozen.",
            { attachmentRefs: requestedAttachmentRefs },
          );
        }
        return {
          instructionId: schemaRecordId(
            "instruction",
            instruction.instructionId ?? instruction.id,
            String(index + 1),
          ),
          text:
            cleanText(
              instruction.text
              ?? instruction.request
              ?? instruction.content,
              20_000,
            )
            || summary,
          targetRefs: requestedRefs.length > 0 ? requestedRefs : targetRefs,
          ...(requestedAttachmentRefs.length > 0
            ? { attachmentRefs: requestedAttachmentRefs }
            : {}),
        };
      });
      const changeRequest = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        status: "frozen",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        createdAt: frozenAt,
        frozenAt,
        freezeCutoffRevision,
        versionIdentity: {
          previousVersionId: activeRun.previousVersionId,
          basedOnVersionId: activeRun.basedOnVersionId,
          candidateVersionId: activeRun.candidateVersionId,
          candidateVersionOrdinal: activeRun.candidateVersionOrdinal,
          candidateVersionLabel: activeRun.candidateVersionLabel,
        },
        baseSnapshot: {
          relativePath: "input/base/index.html",
          byteLength: source.buffer.byteLength,
          sha256: activeRun.baseSnapshotSha256,
          comparisonSha256: comparisonSha256(source.html),
          canonicalizationVersion: CANONICALIZATION_VERSION,
        },
        paths: {
          requestRelativePath: `requests/${requestId}`,
          attemptRelativePath: `requests/${requestId}/attempts/${attemptId}`,
          promptRelativePath: `requests/${requestId}/PROMPT.md`,
          inputManifestRelativePath:
            `requests/${requestId}/input-manifest.json`,
        },
        requirements: {
          summary,
          instructions,
          ...(requestAttachments.length > 0
            ? { attachments: requestAttachments }
            : {}),
          targets,
          preserveOutsideTargets: true,
        },
        annotations: {
          relativePath: "input/annotations/records.json",
          sha256: annotationSha256,
          commentCount: comments.length,
          editEventCount: changeEvents.length,
          attachmentCount: requestAttachments.length,
        },
        finalization: {
          outputRelativePath: output.relativePath,
          completionRelativePath: "completion.json",
          completionSchema: "completion.v1.schema.json",
          supportedFinalizerVersion: FINALIZER_VERSION,
          finalizerCommand: finalizerCommandForRun(context, activeRun),
        },
      };
      await atomicWriteFile(path.join(temporary, "PROMPT.md"), temporaryPrompt);
      await atomicWriteJson(
        path.join(temporary, "change-request.json"),
        changeRequest,
      );
      await atomicWriteFile(
        path.join(temporary, "input", "AI_RULES.md"),
        managedAiRules(),
      );
      await copyFile(
        path.join(context.projectRoot, "PROJECT.md"),
        path.join(temporary, "input", "PROJECT.md"),
      );
      await atomicWriteFile(
        path.join(temporary, "input", "base", "index.html"),
        source.buffer,
      );
      await atomicWriteFile(
        path.join(temporary, "input", "annotations", "records.json"),
        annotationText,
      );
      const readOrder = [
        "PROMPT.md",
        "input/AI_RULES.md",
        "change-request.json",
        "input/PROJECT.md",
        "input/base/index.html",
        ...frozenAttachments.files.map(
          (attachment) => attachment.requestRelativePath,
        ),
      ];
      const fileDefinitions = [
        ["PROMPT.md", "prompt", "text/markdown"],
        ["input/AI_RULES.md", "policy", "text/markdown"],
        ["change-request.json", "change-request", "application/json"],
        ["input/PROJECT.md", "project-rules", "text/markdown"],
        ["input/base/index.html", "base-html", "text/html"],
        [
          "input/annotations/records.json",
          "annotations",
          "application/json",
        ],
        ...frozenAttachments.files.map((attachment) => [
          attachment.requestRelativePath,
          "reference",
          attachment.mediaType,
        ]),
      ];
      const inputManifest = {
        schemaVersion: "1.0.0",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        frozen: true,
        createdAt: frozenAt,
        readOrder,
        files: await Promise.all(
          fileDefinitions.map(([relativePath, role, mediaType]) =>
            requestFileRecord(
              temporary,
              relativePath,
              role,
              mediaType,
            )
          ),
        ),
      };
      await atomicWriteJson(
        path.join(temporary, "input-manifest.json"),
        inputManifest,
      );
      activeRun.inputManifestSha256 = sha256(
        await readFile(path.join(temporary, "input-manifest.json")),
      );
      activeRun.inputManifestRelativePath =
        `requests/${requestId}/input-manifest.json`;
      activeRun.requestRelativePath = `requests/${requestId}`;
      activeRun.attemptRelativePath =
        `requests/${requestId}/attempts/${attemptId}`;
      activeRun.outputRelativePath =
        `${activeRun.attemptRelativePath}/${output.relativePath}`;
      activeRun.completionRelativePath =
        `${activeRun.attemptRelativePath}/completion.json`;
      activeRun.frozenAnnotationsRelativePath =
        `requests/${requestId}/input/annotations/records.json`;
      activeRun.frozenAnnotationsSha256 = annotationSha256;
      activeRun.frozenCommentIds = comments
        .map((item) => item.commentId ?? item.id)
        .filter(Boolean);
      activeRun.frozenEditEventIds = changeEvents
        .map((item) => item.eventId ?? item.id)
        .filter(Boolean);
      activeRun.submittedAt = frozenAt;
      runtime.activeRun = activeRun;
      await writeRuntime(context.projectRoot, runtime);
      await maybeFailpoint(
        "after-request-prepared",
        path.join(context.projectRoot, "recovery"),
      );
      await rename(temporary, requestRoot);
      await syncDirectory(requestsRoot);
      if (!(await exists(temporaryAttempt.replace(temporary, requestRoot)))) {
        throw new Error("Attempt publication failed.");
      }
      await maybeFailpoint(
        "after-request-published",
        path.join(context.projectRoot, "recovery"),
      );
    } catch (error) {
      if (error?.code === "INJECTED_FAILPOINT") throw error;
      await rm(temporary, { recursive: true, force: true });
      runtime.lifecycleState = "editing";
      runtime.activeRun = null;
      await writeRuntime(context.projectRoot, runtime);
      throw error;
    }
    activeRun.status = "processing";
    activeRun.updatedAt = nowIso();
    runtime.lifecycleState = "processing";
    runtime.activeRun = activeRun;
    await writeRuntime(context.projectRoot, runtime);
    const handoffMessage = activeRun.handoffMessage;
    return {
      ok: true,
      projectId: context.projectId,
      documentId: context.documentId,
      sourcePath: context.sourcePath,
      sourceSha256: source.sha256,
      requestId,
      attemptId,
      previousVersionId: activeRun.previousVersionId,
      basedOnVersionId: activeRun.basedOnVersionId,
      candidateVersionId: activeRun.candidateVersionId,
      candidateVersionLabel: activeRun.candidateVersionLabel,
      candidateDisplayVersionLabel:
        userVersionLabel(activeRun.candidateVersionOrdinal),
      plannedWorkingCopyPath: path.join(
        context.projectRoot,
        ...workingCopyDescriptor(
          project.displayName,
          activeRun.candidateVersionOrdinal,
        ).relativePath.split("/"),
      ),
      freezeCutoffRevision,
      requestPath: requestRoot,
      attemptPath: attemptRoot,
      promptPath: path.join(requestRoot, "PROMPT.md"),
      inputPath: path.join(requestRoot, "input", "base", "index.html"),
      outputPath: path.join(attemptRoot, ...output.relativePath.split("/")),
      completionPath: path.join(attemptRoot, "completion.json"),
      resultPath: path.join(attemptRoot, "result.json"),
      activeRun,
      handoffMessage,
    };
  });
}

async function assertAttemptProtocolSurfaceRaw(
  attemptRoot,
  outputRelativePath,
) {
  const entries = await readdir(attemptRoot, { withFileTypes: true });
  const unexpected = findUnexpectedAttemptEntry(entries);
  if (unexpected) {
    throw new HttpError(
      422,
      "OUTPUT_PROTOCOL_VIOLATION",
      `Attempt contains unauthorized entry ${unexpected.name}.`,
    );
  }
  const outputRoot = path.join(attemptRoot, "output");
  const outputEntries = await readdir(outputRoot, { withFileTypes: true });
  const unexpectedOutput = findUnexpectedAttemptOutputEntry(
    outputEntries,
    path.posix.basename(outputRelativePath),
  );
  if (unexpectedOutput) {
    throw new HttpError(
      422,
      "OUTPUT_PROTOCOL_VIOLATION",
      `Attempt output contains unauthorized entry ${unexpectedOutput.name}.`,
    );
  }
}

async function validateCompletionRaw(context, runtime) {
  const activeRun = runtime.activeRun;
  if (!activeRun) {
    throw new HttpError(409, "ACTIVE_RUN_NOT_FOUND", "No active run exists.");
  }
  const requestRoot = path.join(
    context.projectRoot,
    "requests",
    activeRun.requestId,
  );
  const attemptRoot = path.join(
    requestRoot,
    "attempts",
    activeRun.attemptId,
  );
  const completionPath = path.join(attemptRoot, "completion.json");
  await validateRequestPublicationRaw(context, activeRun, requestRoot);
  await readLifecycleJson(
    path.join(requestRoot, "input", "annotations", "records.json"),
    "input/annotations/records.json",
  );
  const changeRequest = await readLifecycleJson(
    path.join(requestRoot, "change-request.json"),
    "change-request.json",
  );
  const outputRelativePath = await outputRelativePathForActiveRun(
    context,
    activeRun,
    changeRequest,
  );
  await assertAttemptProtocolSurfaceRaw(attemptRoot, outputRelativePath);
  if (!(await exists(completionPath))) {
    return { waiting: true, requestRoot, attemptRoot, completionPath };
  }
  if (await exists(path.join(attemptRoot, "cancelled.json"))) {
    throw new HttpError(
      409,
      "ATTEMPT_CANCELLED",
      "A cancelled Attempt cannot be committed.",
    );
  }
  const completion = await readAuxiliaryJson(
    completionPath,
    "completion.json",
  );
  const completionBuffer = await readFile(completionPath);
  validateCompletionSchema(completion);
  const constants = {
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    finalizerVersion: FINALIZER_VERSION,
    status: "completed",
    projectId: activeRun.projectId,
    documentId: activeRun.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    previousVersionId: activeRun.previousVersionId,
    basedOnVersionId: activeRun.basedOnVersionId,
    candidateVersionId: activeRun.candidateVersionId,
    candidateVersionOrdinal: activeRun.candidateVersionOrdinal,
    candidateVersionLabel: activeRun.candidateVersionLabel,
    baseSnapshotSha256: activeRun.baseSnapshotSha256,
    outputRelativePath,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    inputManifestSha256: activeRun.inputManifestSha256,
  };
  for (const [key, expected] of Object.entries(constants)) {
    if (completion[key] !== expected) {
      throw new HttpError(
        422,
        "COMPLETION_IDENTITY_MISMATCH",
        `completion.json ${key} does not match the active run.`,
        { key, expected, actual: completion[key] },
      );
    }
  }
  requireSha256(completion.outputSha256, "completion.outputSha256");
  requireSha256(
    completion.baseComparisonSha256,
    "completion.baseComparisonSha256",
  );
  requireSha256(
    completion.outputComparisonSha256,
    "completion.outputComparisonSha256",
  );
  const outputPath = path.join(
    attemptRoot,
    ...outputRelativePath.split("/"),
  );
  const outputBuffer = await readFile(outputPath);
  const outputHtml = outputBuffer.toString("utf8");
  requireCompleteHtml(outputHtml, outputRelativePath);
  assertCanonicalManagedMeta(outputHtml, activeRun, outputRelativePath);
  if (sha256(outputBuffer) !== completion.outputSha256) {
    throw new HttpError(
      422,
      "OUTPUT_HASH_MISMATCH",
      `${outputRelativePath} changed after finalization.`,
    );
  }
  const baseBuffer = await readFile(
    path.join(requestRoot, "input", "base", "index.html"),
  );
  if (sha256(baseBuffer) !== activeRun.baseSnapshotSha256) {
    throw new HttpError(
      422,
      "BASE_SNAPSHOT_HASH_MISMATCH",
      "The frozen input changed after submission.",
    );
  }
  const actualBaseComparisonSha256 = comparisonSha256(
    baseBuffer.toString("utf8"),
  );
  const actualOutputComparisonSha256 = comparisonSha256(
    outputBuffer.toString("utf8"),
  );
  if (
    completion.baseComparisonSha256 !== actualBaseComparisonSha256
    || completion.outputComparisonSha256 !== actualOutputComparisonSha256
  ) {
    throw new HttpError(
      422,
      "COMPARISON_HASH_MISMATCH",
      "Completion comparison hashes do not match actual HTML.",
    );
  }
  const supplement = await validateAttemptSupplement(context, {
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    attemptRoot,
    changeRequest,
    requireSealed: true,
  });
  return {
    waiting: false,
    completion,
    completionBuffer,
    completionPath,
    requestRoot,
    attemptRoot,
    outputPath,
    outputBuffer,
    baseBuffer,
    changeRequest,
    supplement,
  };
}

function candidateAssessmentIdentity(context, activeRun, validated) {
  return {
    schemaVersion: AUXILIARY_SCHEMA_VERSION,
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    candidateVersionId: activeRun.candidateVersionId,
    baseSha256: activeRun.baseSnapshotSha256,
    outputSha256: validated.completion.outputSha256,
    baseComparisonSha256: validated.completion.baseComparisonSha256,
    outputComparisonSha256: validated.completion.outputComparisonSha256,
  };
}

async function readHistoricalCandidateAssessment(
  assessmentPath,
  assessment,
  expected,
) {
  const label = "candidate-assessment.json";
  const normalized = decodeCandidateAssessmentRecord(assessment, {
    expected,
    label,
  });
  const attemptRoot = path.dirname(assessmentPath);
  const requestRoot = path.dirname(path.dirname(attemptRoot));
  const projectRoot = path.dirname(path.dirname(requestRoot));
  const committedCandidatePath = path.join(
    projectRoot,
    "versions",
    normalized.candidateVersionId,
    "files",
    "index.html",
  );
  const completionPath = path.join(attemptRoot, "completion.json");
  const completion = await exists(completionPath)
    ? await readAuxiliaryJson(completionPath, "completion.json")
    : null;
  const outputRelativePath = typeof completion?.outputRelativePath === "string"
    ? completion.outputRelativePath
    : "output/index.html";
  const candidateEvidencePath = await exists(committedCandidatePath)
    ? committedCandidatePath
    : path.join(attemptRoot, ...outputRelativePath.split("/"));
  const sources = [
    [path.join(requestRoot, "input", "base", "index.html"), "frozen base"],
    [candidateEvidencePath, "immutable candidate"],
  ];
  const buffers = [];
  for (const [sourcePath, sourceLabel] of sources) {
    const information = await lstat(sourcePath).catch((error) => {
      if (error?.code === "ENOENT") {
        throw new HttpError(
          409,
          "CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_MISSING",
          `${label} ${sourceLabel} evidence is missing.`,
        );
      }
      throw error;
    });
    if (information.isSymbolicLink() || !information.isFile()) {
      throw new HttpError(
        409,
        "CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_INVALID",
        `${label} ${sourceLabel} evidence must be a regular file.`,
      );
    }
    buffers.push(await readFile(sourcePath));
  }
  const [baseBuffer, outputBuffer] = buffers;
  return decodeHistoricalCandidateAssessment(normalized, {
    expected,
    baseBuffer,
    outputBuffer,
    label,
  });
}

async function readCandidateAssessment(
  assessmentPath,
  expected = {},
  { verifyHistoricalEvidence = false } = {},
) {
  const assessment = await readAuxiliaryJson(
    assessmentPath,
    "candidate-assessment.json",
  );
  if (verifyHistoricalEvidence) {
    return readHistoricalCandidateAssessment(
      assessmentPath,
      assessment,
      expected,
    );
  }
  return decodeCandidateAssessmentRecord(assessment, { expected });
}

async function writeCandidateAssessmentRaw(context, runtime, validated) {
  const activeRun = runtime.activeRun;
  const assessment = {
    ...candidateAssessmentIdentity(context, activeRun, validated),
    ...assessHtmlCandidate({
      baseHtml: validated.baseBuffer.toString("utf8"),
      outputHtml: validated.outputBuffer.toString("utf8"),
    }),
    assessedAt: validated.completion.completedAt,
  };
  const assessmentPath = path.join(
    validated.attemptRoot,
    "candidate-assessment.json",
  );
  if (await exists(assessmentPath)) {
    const existing = await readCandidateAssessment(
      assessmentPath,
      candidateAssessmentIdentity(context, activeRun, validated),
    );
    if (jsonText(existing) !== jsonText(assessment)) {
      throw new HttpError(
        409,
        "CANDIDATE_ASSESSMENT_MISMATCH",
        "The persisted candidate assessment does not match the sealed HTML.",
      );
    }
    return { assessment: existing, assessmentPath };
  }
  decodeCandidateAssessmentRecord(assessment, {
    expected: candidateAssessmentIdentity(context, activeRun, validated),
  });
  await atomicWriteJson(assessmentPath, assessment);
  return { assessment, assessmentPath };
}

function pendingCandidatePath(context, activeRun) {
  return path.join(
    context.projectRoot,
    "requests",
    activeRun.requestId,
    "attempts",
    activeRun.attemptId,
    "candidate.json",
  );
}

function pendingCandidateIdentity(context, activeRun, validated) {
  return {
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    candidateVersionId: activeRun.candidateVersionId,
    candidateVersionOrdinal: activeRun.candidateVersionOrdinal,
    candidateVersionLabel: activeRun.candidateVersionLabel,
    expectedSourceSha256: activeRun.baseSnapshotSha256,
    outputRelativePath: activeRun.outputRelativePath,
    completionRelativePath: activeRun.completionRelativePath,
    outputSha256: validated.completion.outputSha256,
    completionSha256: sha256(validated.completionBuffer),
  };
}

function assertPendingCandidateRecord(record, context, activeRun, validated) {
  assertAuxiliarySchemaVersion(record, "candidate.json");
  if (
    record.status !== "pending-review"
    || !record.createdAt
    || Number.isNaN(Date.parse(record.createdAt))
  ) {
    throw new HttpError(
      409,
      "CANDIDATE_RECORD_INVALID",
      "The pending Candidate record is invalid.",
    );
  }
  const expected = pendingCandidateIdentity(context, activeRun, validated);
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) {
      throw new HttpError(
        409,
        "CANDIDATE_IDENTITY_MISMATCH",
        `candidate.json ${key} does not match the finalized Request.`,
        { key, expected: value, actual: record[key] },
      );
    }
  }
  return record;
}

async function writePendingCandidateRaw(context, runtime, validated) {
  const activeRun = runtime.activeRun;
  const candidatePath = pendingCandidatePath(context, activeRun);
  const identity = pendingCandidateIdentity(context, activeRun, validated);
  const record = {
    schemaVersion: AUXILIARY_SCHEMA_VERSION,
    status: "pending-review",
    ...identity,
    createdAt: validated.completion.completedAt,
  };
  if (await exists(candidatePath)) {
    const existing = await readAuxiliaryJson(candidatePath, "candidate.json");
    return {
      candidate: assertPendingCandidateRecord(existing, context, activeRun, validated),
      candidatePath,
      validated,
    };
  }
  await atomicWriteJson(candidatePath, record);
  await maybeFailpoint("after-candidate-prepared", path.dirname(candidatePath));
  return { candidate: record, candidatePath, validated };
}

async function readPendingCandidateRaw(
  context,
  runtime,
  { validated = null } = {},
) {
  const activeRun = runtime?.activeRun;
  if (!activeRun) return null;
  const candidatePath = pendingCandidatePath(context, activeRun);
  if (!(await exists(candidatePath))) return null;
  const proof = validated ?? await validateCompletionRaw(context, runtime);
  if (proof.waiting) {
    throw new HttpError(
      409,
      "CANDIDATE_COMPLETION_MISSING",
      "The pending Candidate no longer has finalization evidence.",
    );
  }
  const candidate = assertPendingCandidateRecord(
    await readAuxiliaryJson(candidatePath, "candidate.json"),
    context,
    activeRun,
    proof,
  );
  const validationReviewPath = path.join(
    proof.attemptRoot,
    "validation-review.json",
  );
  const assessmentPath = path.join(
    proof.attemptRoot,
    "candidate-assessment.json",
  );
  const validationReview = await exists(validationReviewPath)
    ? await readAuxiliaryJson(validationReviewPath, "validation-review.json")
    : null;
  const candidateAssessment = await exists(assessmentPath)
    ? await readCandidateAssessment(
      assessmentPath,
      candidateAssessmentIdentity(context, activeRun, proof),
    )
    : null;
  return {
    candidate,
    candidatePath,
    validated: proof,
    validationReview,
    candidateAssessment,
  };
}

async function pendingCandidateReadyPayload(context, runtime, state) {
  const activeRun = runtime.activeRun;
  const { candidate, validated } = state;
  const currentSource = await readSourceFile(context.sourcePath);
  const version = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId: context.projectId,
    documentId: context.documentId,
    versionId: candidate.candidateVersionId,
    versionOrdinal: candidate.candidateVersionOrdinal,
    versionLabel: candidate.candidateVersionLabel,
    sourceType: "internal-ai-candidate",
    previousVersionId: activeRun.previousVersionId,
    basedOnVersionId: activeRun.basedOnVersionId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    contentSha256: candidate.outputSha256,
    generatedAt: candidate.createdAt,
  };
  const completion = {
    completedAt: validated.completion.completedAt,
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    versionId: candidate.candidateVersionId,
  };
  const outcome = {
    schemaVersion: AUXILIARY_SCHEMA_VERSION,
    status: "candidate-ready",
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    versionId: candidate.candidateVersionId,
    contentSha256: candidate.outputSha256,
    completedAt: validated.completion.completedAt,
    generatedAt: candidate.createdAt,
  };
  return {
    ok: true,
    status: "ready-to-open",
    readyToOpen: true,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    versionId: candidate.candidateVersionId,
    candidateVersionId: candidate.candidateVersionId,
    candidateVersionLabel: candidate.candidateVersionLabel,
    candidateDisplayVersionLabel: userVersionLabel(candidate.candidateVersionOrdinal),
    version,
    completion,
    outcome,
    contentSha256: candidate.outputSha256,
    sourceSha256: currentSource.sha256,
    currentHtmlSha256: currentSource.sha256,
    lastModifiedAt: currentSource.lastModifiedAt,
    activeRun: {
      ...activeRun,
      sourcePath: context.sourcePath,
      status: "ready-to-open",
    },
    currentPath: context.sourcePath,
    workingCopyPath: context.sourcePath,
    candidatePath: candidatePathForResponse(context, activeRun),
    candidateOutputPath: validated.outputPath,
    supplement: validated.supplement,
    ...(state.validationReview ? { validationReview: state.validationReview } : {}),
    ...(state.candidateAssessment ? { candidateAssessment: state.candidateAssessment } : {}),
  };
}

function candidatePathForResponse(context, activeRun) {
  return pendingCandidatePath(context, activeRun);
}

function transactionDirectory(context, transactionId) {
  return path.join(context.projectRoot, "transactions", transactionId);
}

async function writeTransaction(transactionRoot, transaction) {
  assertAuxiliarySchemaVersion(transaction, "transaction.json");
  transaction.updatedAt = nowIso();
  await atomicWriteJson(
    path.join(transactionRoot, "transaction.json"),
    transaction,
  );
}

async function reconcilePendingCommitManifestRaw(
  transactionRoot,
  transaction,
  versionRoot,
) {
  const pendingManifestSha256 =
    transaction.pendingCandidateManifestSha256;
  const pendingGeneratedAt = transaction.pendingVersionGeneratedAt;
  if (!pendingManifestSha256 && !pendingGeneratedAt) return;
  if (!pendingManifestSha256 || !pendingGeneratedAt) {
    throw new HttpError(
      409,
      "TRANSACTION_COMMIT_MANIFEST_INTENT_INCOMPLETE",
      "The Version commit-manifest intent is incomplete.",
    );
  }
  const manifestPath = path.join(versionRoot, "version.json");
  const currentBuffer = await readFile(manifestPath);
  const currentSha256 = sha256(currentBuffer);
  if (currentSha256 === pendingManifestSha256) {
    const currentManifest = JSON.parse(currentBuffer.toString("utf8"));
    assertLifecycleSchemaVersion(currentManifest, "version.json");
    if (currentManifest.generatedAt !== pendingGeneratedAt) {
      throw new HttpError(
        409,
        "TRANSACTION_COMMIT_TIME_MISMATCH",
        "The pending Version manifest hash and generation time disagree.",
      );
    }
  } else if (currentSha256 === transaction.candidateManifestSha256) {
    const pendingManifest = JSON.parse(currentBuffer.toString("utf8"));
    assertLifecycleSchemaVersion(pendingManifest, "version.json");
    pendingManifest.generatedAt = pendingGeneratedAt;
    const pendingBuffer = Buffer.from(jsonText(pendingManifest), "utf8");
    if (sha256(pendingBuffer) !== pendingManifestSha256) {
      throw new HttpError(
        409,
        "TRANSACTION_COMMIT_MANIFEST_HASH_MISMATCH",
        "The pending Version manifest cannot be reproduced from the transaction.",
      );
    }
    await atomicWriteFile(manifestPath, pendingBuffer);
  } else {
    throw new HttpError(
      409,
      "TRANSACTION_MANIFEST_HASH_MISMATCH",
      "The Version manifest matches neither the committed transaction hash nor its pending commit intent.",
    );
  }
  transaction.candidateManifestSha256 = pendingManifestSha256;
  transaction.versionGeneratedAt = pendingGeneratedAt;
  delete transaction.pendingCandidateManifestSha256;
  delete transaction.pendingVersionGeneratedAt;
  await writeTransaction(transactionRoot, transaction);
}

async function prepareCommitManifestRaw(
  transactionRoot,
  transaction,
  versionRoot,
) {
  await reconcilePendingCommitManifestRaw(
    transactionRoot,
    transaction,
    versionRoot,
  );
  const manifestPath = path.join(versionRoot, "version.json");
  const committedPath = path.join(versionRoot, "committed.json");
  if (await exists(committedPath)) {
    const [manifestBuffer, committed] = await Promise.all([
      readFile(manifestPath),
      readAuxiliaryJson(committedPath, "committed.json"),
    ]);
    const manifest = JSON.parse(manifestBuffer.toString("utf8"));
    assertLifecycleSchemaVersion(manifest, "version.json");
    if (
      committed.transactionId !== transaction.transactionId
      || committed.manifestSha256 !== transaction.candidateManifestSha256
      || committed.manifestSha256 !== sha256(manifestBuffer)
      || committed.committedAt !== manifest.generatedAt
    ) {
      throw new HttpError(
        409,
        "COMMIT_MARKER_TIME_MISMATCH",
        "The existing commit marker does not match the Version manifest and its generation time.",
      );
    }
    transaction.versionGeneratedAt = committed.committedAt;
    return committed.committedAt;
  }

  const currentBuffer = await readFile(manifestPath);
  const currentSha256 = sha256(currentBuffer);
  if (currentSha256 !== transaction.candidateManifestSha256) {
    throw new HttpError(
      409,
      "TRANSACTION_MANIFEST_HASH_MISMATCH",
      "The Version manifest changed before its commit timestamp was sealed.",
    );
  }
  const generatedAt = nowIso();
  const manifest = JSON.parse(currentBuffer.toString("utf8"));
  assertLifecycleSchemaVersion(manifest, "version.json");
  manifest.generatedAt = generatedAt;
  const sealedBuffer = Buffer.from(jsonText(manifest), "utf8");
  const sealedSha256 = sha256(sealedBuffer);

  transaction.pendingCandidateManifestSha256 = sealedSha256;
  transaction.pendingVersionGeneratedAt = generatedAt;
  await writeTransaction(transactionRoot, transaction);
  await maybeFailpoint("after-commit-manifest-pending", transactionRoot);
  await atomicWriteFile(manifestPath, sealedBuffer);
  await maybeFailpoint("after-commit-manifest-written", transactionRoot);
  transaction.candidateManifestSha256 = sealedSha256;
  transaction.versionGeneratedAt = generatedAt;
  delete transaction.pendingCandidateManifestSha256;
  delete transaction.pendingVersionGeneratedAt;
  await writeTransaction(transactionRoot, transaction);
  return generatedAt;
}

async function maybeFailpoint(name, markerRoot) {
  if (process.env.HTML_AI_FAILPOINT !== name) return;
  await ensureDirectory(markerRoot);
  const marker = path.join(markerRoot, `.failpoint-${name}`);
  if (await exists(marker)) return;
  await atomicWriteFile(marker, name);
  throw new InjectedFailpointError(name);
}

async function prepareTransactionRaw(
  context,
  runtime,
  validated,
  expectedSourceSha256,
  options = {},
) {
  const activeRun = runtime.activeRun;
  const transactionId =
    `txn_${activeRun.requestId}_${activeRun.attemptId}`;
  const transactionRoot = transactionDirectory(context, transactionId);
  const transactionPath = path.join(transactionRoot, "transaction.json");
  if (await exists(transactionPath)) {
    return {
      transactionRoot,
      transaction: await readAuxiliaryJson(
        transactionPath,
        "transaction.json",
      ),
    };
  }
  await ensureDirectory(path.join(transactionRoot, "prepared-version", "files"));
  await ensureDirectory(
    path.join(transactionRoot, "prepared-version", "annotations"),
  );
  await ensureDirectory(path.join(transactionRoot, "recovery"));
  const source = await readSourceFile(context.sourcePath);
  if (
    source.sha256 !== expectedSourceSha256
    && options.allowSourceMismatch !== true
  ) {
    throw new HttpError(
      409,
      "SOURCE_HASH_CONFLICT",
      "Source changed before transaction preparation.",
      {
        expectedSourceSha256,
        actualSourceSha256: source.sha256,
      },
    );
  }
  await atomicWriteFile(
    path.join(transactionRoot, "recovery", "source.html"),
    source.buffer,
  );
  await atomicWriteFile(
    path.join(
      transactionRoot,
      "prepared-version",
      "files",
      "index.html",
    ),
    validated.outputBuffer,
  );
  const annotationRequestRelativePath =
    `requests/${activeRun.requestId}/input/annotations/records.json`;
  const annotationAttemptRelativePath =
    `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/annotations.json`;
  const annotationBuffer = await readFile(
    path.join(
      context.projectRoot,
      ...annotationRequestRelativePath.split("/"),
    ),
  );
  const annotationSha256 = sha256(annotationBuffer);
  if (
    activeRun.frozenAnnotationsSha256
    && activeRun.frozenAnnotationsSha256 !== annotationSha256
  ) {
    throw new HttpError(
      422,
      "FROZEN_ANNOTATIONS_HASH_MISMATCH",
      "Frozen Request annotations changed before Version preparation.",
    );
  }
  await atomicWriteFile(
    path.join(
      context.projectRoot,
      ...annotationAttemptRelativePath.split("/"),
    ),
    annotationBuffer,
  );
  await atomicWriteFile(
    path.join(
      transactionRoot,
      "prepared-version",
      "annotations",
      "records.json",
    ),
    annotationBuffer,
  );
  const summary = activeRun.summary;
  // This prepared manifest is not a visible Version yet. The final
  // generatedAt is sealed immediately before committed.json is written so
  // conflict wait time and transaction recovery time cannot masquerade as
  // the successful Version generation time.
  const generatedAt = validated.completion.completedAt;
  const manifest = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId: context.projectId,
    documentId: context.documentId,
    versionId: activeRun.candidateVersionId,
    versionOrdinal: activeRun.candidateVersionOrdinal,
    versionLabel: activeRun.candidateVersionLabel,
    sourceType: "internal-ai",
    previousVersionId: activeRun.previousVersionId,
    basedOnVersionId: activeRun.basedOnVersionId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    baseSnapshotSha256: activeRun.baseSnapshotSha256,
    inputManifestSha256: activeRun.inputManifestSha256,
    contentSha256: validated.completion.outputSha256,
    baseComparisonSha256: validated.completion.baseComparisonSha256,
    contentComparisonSha256:
      validated.completion.outputComparisonSha256,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    generatedAt,
    summary,
    completionRelativePath:
      `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/completion.json`,
    outcomeRelativePath:
      `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/outcome.json`,
    annotationArchive: {
      versionRelativePath: "annotations/records.json",
      requestRelativePath: annotationRequestRelativePath,
      attemptRelativePath: annotationAttemptRelativePath,
      sha256: annotationSha256,
      commentCount: activeRun.frozenComments?.length ?? 0,
      editEventCount: activeRun.frozenChangeEvents?.length ?? 0,
    },
    files: [
      {
        path: "files/index.html",
        role: "entry-html",
        mediaType: "text/html",
        byteLength: validated.outputBuffer.byteLength,
        sha256: validated.completion.outputSha256,
      },
    ],
  };
  await atomicWriteJson(
    path.join(transactionRoot, "prepared-version", "version.json"),
    manifest,
  );
  const candidateManifestSha256 = sha256(
    await readFile(
      path.join(transactionRoot, "prepared-version", "version.json"),
    ),
  );
  const completionSha256 = sha256(await readFile(validated.completionPath));
  const createdAt = nowIso();
  const project = await readProject(context);
  const workingCopy = workingCopyDescriptor(
    project.displayName,
    activeRun.candidateVersionOrdinal,
  );
  const activeWorkingCopyRelativePath = workingCopy.relativePath;
  const transaction = {
    schemaVersion: "1.0.0",
    transactionId,
    state: "prepared",
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    basedOnVersionId: activeRun.basedOnVersionId,
    previousVersionId: activeRun.previousVersionId,
    candidateVersionId: activeRun.candidateVersionId,
    candidateVersionOrdinal: activeRun.candidateVersionOrdinal,
    candidateVersionLabel: activeRun.candidateVersionLabel,
    workingCopyStem: workingCopy.stem,
    previousSourcePath: context.sourcePath,
    expectedSourceSha256,
    baseSnapshotSha256: activeRun.baseSnapshotSha256,
    candidateContentSha256: validated.completion.outputSha256,
    candidateManifestSha256,
    completionSha256,
    outputRelativePath: activeRun.outputRelativePath,
    completionRelativePath: path.relative(
      context.projectRoot,
      validated.completionPath,
    ),
    paths: {
      preparedVersionRelativePath:
        `transactions/${transactionId}/prepared-version`,
      recoverySourceRelativePath:
        `transactions/${transactionId}/recovery/source.html`,
      publishedVersionRelativePath:
        `versions/${activeRun.candidateVersionId}`,
      commitMarkerRelativePath:
        `versions/${activeRun.candidateVersionId}/committed.json`,
      activeWorkingCopyRelativePath,
    },
    recoverySourceSha256: source.sha256,
    createdAt,
    preparedAt: createdAt,
    ...(options.adoptionRequestedAt
      ? {
          adoptionRequestedAt: options.adoptionRequestedAt,
          activationState: "requested",
        }
      : {}),
  };
  await writeTransaction(transactionRoot, transaction);
  if (options.adoptionRequestedAt) {
    await maybeFailpoint("after-adoption-intent", transactionRoot);
  }
  runtime.lifecycleState = "committing";
  runtime.transactionId = transactionId;
  runtime.activeRun.status = "committing";
  runtime.activeRun.updatedAt = nowIso();
  await writeRuntime(context.projectRoot, runtime);
  await maybeFailpoint("after-prepared", transactionRoot);
  return { transactionRoot, transaction };
}

async function markAiConflictRaw(
  context,
  runtime,
  validated,
  actualSourceSha256,
  transaction = null,
) {
  const activeRun = runtime.activeRun;
  const conflict = {
    conflictId: `conflict_${activeRun.requestId}_${activeRun.attemptId}`,
    type: "ai-source",
    transactionId:
      transaction?.transactionId
      ?? runtime.transactionId
      ?? null,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    candidateVersionId: activeRun.candidateVersionId,
    expectedSourceSha256: activeRun.baseSnapshotSha256,
    externalSourceSha256: actualSourceSha256,
    candidateOutputSha256: validated.completion.outputSha256,
    candidateRelativePath: activeRun.outputRelativePath,
    detectedAt: nowIso(),
  };
  runtime.lifecycleState = "awaiting-conflict-resolution";
  runtime.activeRun.status = "awaiting-conflict-resolution";
  runtime.activeRun.conflictId = conflict.conflictId;
  runtime.activeRun.updatedAt = nowIso();
  runtime.conflict = conflict;
  await writeRuntime(context.projectRoot, runtime);
  return {
    ...conflict,
  };
}

function activeRunFromTransaction(context, transaction) {
  const requestRoot = path.join(
    context.projectRoot,
    "requests",
    transaction.requestId,
  );
  const attemptRoot = path.join(
    requestRoot,
    "attempts",
    transaction.attemptId,
  );
  const { outputRelativePath } = outputPathIdentityFromTransaction(transaction);
  return {
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: transaction.requestId,
    attemptId: transaction.attemptId,
    status: "committing",
    sourcePath: context.sourcePath,
    requestPath: requestRoot,
    attemptPath: attemptRoot,
    promptPath: path.join(requestRoot, "PROMPT.md"),
    outputRelativePath,
    outputPath: path.join(context.projectRoot, ...outputRelativePath.split("/")),
    completionPath: path.join(attemptRoot, "completion.json"),
    previousVersionId: transaction.previousVersionId,
    basedOnVersionId: transaction.basedOnVersionId,
    candidateVersionId: transaction.candidateVersionId,
    candidateVersionOrdinal: transaction.candidateVersionOrdinal,
    candidateVersionLabel: transaction.candidateVersionLabel,
    baseSnapshotSha256: transaction.baseSnapshotSha256,
  };
}

async function archiveAttemptOutcomeRaw(
  context,
  activeRun,
  outcome,
) {
  if (!activeRun?.requestId || !activeRun?.attemptId) return;
  const requestRoot = path.join(
    context.projectRoot,
    "requests",
    activeRun.requestId,
  );
  const attemptRoot = path.join(
    requestRoot,
    "attempts",
    activeRun.attemptId,
  );
  const requestAnnotations = path.join(
    requestRoot,
    "input",
    "annotations",
    "records.json",
  );
  const attemptAnnotations = path.join(attemptRoot, "annotations.json");
  const attemptAnnotationsExist = await exists(attemptAnnotations);
  const annotationBuffer = await readFile(
    attemptAnnotationsExist ? attemptAnnotations : requestAnnotations,
  );
  let annotations = null;
  try {
    annotations = JSON.parse(annotationBuffer.toString("utf8"));
    assertLifecycleSchemaVersion(annotations, "annotations.json");
  } catch (error) {
    if (outcome.status !== "cancelled") throw error;
  }
  if (!attemptAnnotationsExist) {
    await atomicWriteFile(attemptAnnotations, annotationBuffer);
  }
  const annotationArchive = {
    requestRelativePath:
      `requests/${activeRun.requestId}/input/annotations/records.json`,
    attemptRelativePath:
      `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/annotations.json`,
    sha256: sha256(annotationBuffer),
    commentCount:
      annotations?.comments?.length
      ?? activeRun.frozenCommentIds?.length
      ?? 0,
    editEventCount:
      annotations?.editEvents?.length
      ?? activeRun.frozenEditEventIds?.length
      ?? 0,
  };
  const common = {
    schemaVersion: "1.0.0",
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    previousVersionId: activeRun.previousVersionId,
    basedOnVersionId: activeRun.basedOnVersionId,
    candidateVersionId: activeRun.candidateVersionId,
    candidateVersionOrdinal: activeRun.candidateVersionOrdinal,
    candidateVersionLabel: activeRun.candidateVersionLabel,
    baseSnapshotSha256: activeRun.baseSnapshotSha256,
  };
  const completionRelativePath =
    `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/completion.json`;
  const completionPath = path.join(context.projectRoot, completionRelativePath);
  const completionBuffer = await exists(completionPath)
    ? await readFile(completionPath)
    : null;
  const completion = completionBuffer
    ? JSON.parse(completionBuffer.toString("utf8"))
    : null;
  if (completion) {
    assertAuxiliarySchemaVersion(completion, "completion.json");
  }
  let archivedOutcome;
  if (outcome.status === "version-created") {
    archivedOutcome = {
      ...common,
      status: "version-created",
      annotationArchive: {
        versionRelativePath: "annotations/records.json",
        ...annotationArchive,
      },
      versionId: outcome.versionId ?? activeRun.candidateVersionId,
      versionManifestRelativePath:
        `versions/${activeRun.candidateVersionId}/version.json`,
      commitMarkerRelativePath:
        `versions/${activeRun.candidateVersionId}/committed.json`,
      transactionId: outcome.transactionId,
      contentSha256: outcome.contentSha256,
      completionRelativePath,
      completionSha256: sha256(completionBuffer),
      committedAt: outcome.committedAt,
    };
  } else if (outcome.status === "no-change") {
    archivedOutcome = {
      ...common,
      status: "no-change",
      annotationArchive,
      completionRelativePath,
      completionSha256: sha256(completionBuffer),
      outputSha256: completion.outputSha256,
      baseComparisonSha256: completion.baseComparisonSha256,
      outputComparisonSha256: completion.outputComparisonSha256,
      completedAt: outcome.completedAt,
    };
  } else if (outcome.status === "cancelled") {
    archivedOutcome = {
      ...common,
      status: "cancelled",
      annotationArchive,
      reason: outcome.reason,
      cancelledAt: outcome.cancelledAt,
    };
  } else if (outcome.status === "conflict-kept-external") {
    archivedOutcome = {
      ...common,
      status: "external-source-kept",
      annotationArchive,
      completionRelativePath,
      completionSha256: sha256(completionBuffer),
      candidateOutputSha256: completion.outputSha256,
      externalSourceSha256: outcome.sourceSha256,
      resolvedAt: outcome.completedAt,
    };
  } else {
    archivedOutcome = {
      ...common,
      status: "failed",
      annotationArchive,
      error: {
        code: outcome.error?.code ?? "ATTEMPT_FAILED",
        message: outcome.error?.message ?? "Attempt failed.",
      },
      failedAt: outcome.completedAt ?? nowIso(),
    };
  }
  await atomicWriteJson(
    path.join(attemptRoot, "outcome.json"),
    archivedOutcome,
  );
  await atomicWriteJson(
    path.join(requestRoot, "outcome.json"),
    archivedOutcome,
  );
  return archivedOutcome;
}

async function finalizeCommittedTransactionRaw(
  context,
  transactionRoot,
  transaction,
) {
  const versionRoot = path.join(
    context.projectRoot,
    "versions",
    transaction.candidateVersionId,
  );
  const validatedVersion = await validateCommittedVersionRaw(
    context,
    transaction.candidateVersionId,
  );
  const { manifest, committed, entryBuffer: versionBuffer } = validatedVersion;
  if (
    committed.transactionId !== transaction.transactionId
    || committed.manifestSha256 !== transaction.candidateManifestSha256
  ) {
    throw new HttpError(
      409,
      "COMMITTED_MARKER_IDENTITY_MISMATCH",
      "Committed Version marker does not match its transaction.",
    );
  }
  if (sha256(versionBuffer) !== transaction.candidateContentSha256) {
    throw new HttpError(
      409,
      "COMMITTED_VERSION_HASH_MISMATCH",
      "Committed Version content does not match its transaction.",
    );
  }
  const workingCopy = await ensureWorkingCopyRaw(
    context,
    transaction,
    versionBuffer,
  );
  const currentSource = await readSourceFile(context.sourcePath);
  const project = await readLifecycleJson(
    path.join(context.projectRoot, "project.json"),
    "project.json",
  );
  if (
    project.projectId !== context.projectId
    || project.documentId !== context.documentId
  ) {
    throw new HttpError(
      409,
      "PROJECT_IDENTITY_MISMATCH",
      "Project metadata does not match the committed transaction.",
    );
  }
  // The Version bytes are now committed, but its official position remains
  // unchanged until the caller completes the explicit adoption transition.
  // `activateReadyVersion` advances latestVersionId together with switching
  // the current Working Copy.
  const completedRun =
    (await readRuntime(context)).activeRun
    ?? activeRunFromTransaction(context, transaction);
  const completion = await readAuxiliaryJson(
    path.join(
      context.projectRoot,
      ...transaction.completionRelativePath.split("/"),
    ),
    "completion.json",
  );
  const attemptRoot = path.join(
    context.projectRoot,
    "requests",
    transaction.requestId,
    "attempts",
    transaction.attemptId,
  );
  const validationReviewPath = path.join(
    attemptRoot,
    "validation-review.json",
  );
  const validationReview = await exists(validationReviewPath)
    ? await readAuxiliaryJson(
        validationReviewPath,
        "validation-review.json",
      )
    : null;
  const candidateAssessmentPath = path.join(
    attemptRoot,
    "candidate-assessment.json",
  );
  const candidateAssessment = await exists(candidateAssessmentPath)
    ? await readCandidateAssessment(
        candidateAssessmentPath,
        {
          projectId: context.projectId,
          documentId: context.documentId,
          requestId: transaction.requestId,
          attemptId: transaction.attemptId,
          candidateVersionId: transaction.candidateVersionId,
          baseSha256: transaction.baseSnapshotSha256,
          outputSha256: transaction.candidateContentSha256,
        },
      )
    : null;
  const supplement = await validateAttemptSupplement(context, {
    requestId: transaction.requestId,
    attemptId: transaction.attemptId,
    attemptRoot,
    requireSealed: true,
  });
  const outcome = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    status: "version-created",
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: transaction.requestId,
    attemptId: transaction.attemptId,
    versionId: transaction.candidateVersionId,
    contentSha256: transaction.candidateContentSha256,
    transactionId: transaction.transactionId,
    completedAt: completion.completedAt,
    generatedAt: manifest.generatedAt,
    committedAt: committed.committedAt,
  };
  await archiveAttemptOutcomeRaw(context, completedRun, outcome);
  const runtime = await readRuntime(context);
  runtime.lifecycleState = "ready-to-open";
  runtime.activeRun = {
    ...completedRun,
    status: "ready-to-open",
    updatedAt: nowIso(),
  };
  runtime.conflict = null;
  runtime.transactionId = transaction.transactionId;
  runtime.view = {
    ...runtime.view,
    latestVersionId: project.latestVersionId,
  };
  runtime.lastCompleted = outcome;
  await writeRuntime(context.projectRoot, runtime);
  transaction.state = "ready-to-open";
  transaction.readyToOpenAt ??= nowIso();
  await writeTransaction(transactionRoot, transaction);
  await maybeFailpoint("after-finalization", transactionRoot);
  return {
    ok: true,
    status: "ready-to-open",
    readyToOpen: true,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
    requestId: transaction.requestId,
    attemptId: transaction.attemptId,
    versionId: transaction.candidateVersionId,
    candidateVersionId: transaction.candidateVersionId,
    candidateVersionLabel:
      transaction.candidateVersionLabel ?? manifest.versionLabel,
    candidateDisplayVersionLabel:
      userVersionLabel(transaction.candidateVersionOrdinal),
    version: manifest,
    completion: {
      completedAt: completion.completedAt,
    },
    supplement,
    ...(validationReview ? { validationReview } : {}),
    ...(candidateAssessment ? { candidateAssessment } : {}),
    outcome,
    contentSha256: transaction.candidateContentSha256,
    sourceSha256: currentSource.sha256,
    currentHtmlSha256: currentSource.sha256,
    lastModifiedAt: currentSource.lastModifiedAt,
    committedAt: committed.committedAt,
    activeRun: {
      ...completedRun,
      sourcePath: context.sourcePath,
      status: "ready-to-open",
    },
    currentPath: context.sourcePath,
    workingCopyPath: workingCopy.absolutePath,
    workingCopyRelativePath: workingCopy.relativePath,
    versionEntryRelativePath:
      `projects/${context.storageDirectoryName}/versions/${transaction.candidateVersionId}/files/index.html`,
    versionEntryPath: path.join(versionRoot, "files", "index.html"),
  };
}

async function markTransactionAdoptionRequestedRaw(transactionRoot, transaction) {
  if (transaction.adoptionRequestedAt) return transaction;
  transaction.adoptionRequestedAt = nowIso();
  transaction.activationState = "requested";
  await writeTransaction(transactionRoot, transaction);
  await maybeFailpoint("after-adoption-intent", transactionRoot);
  return transaction;
}

async function completeTransactionActivationRaw(
  context,
  transactionRoot,
  transaction,
) {
  if (
    transaction.state !== "ready-to-open"
    || !transaction.adoptionRequestedAt
    || transaction.projectId !== context.projectId
    || transaction.documentId !== context.documentId
  ) {
    throw new HttpError(
      409,
      "READY_TRANSACTION_MISMATCH",
      "The transaction is not a complete explicit-adoption boundary.",
    );
  }
  const requestedVersionId = transaction.candidateVersionId;
  const runtime = await readRuntime(context);
  const activeRun = runtime.activeRun
    ?? activeRunFromTransaction(context, transaction);
  const validatedVersion = await validateCommittedVersionRaw(
    context,
    requestedVersionId,
  );
  if (validatedVersion.contentSha256 !== transaction.candidateContentSha256) {
    throw new HttpError(
      409,
      "READY_VERSION_HASH_MISMATCH",
      "The ready Version no longer matches its committed transaction.",
    );
  }
  const workingCopy = await ensureWorkingCopyRaw(
    context,
    transaction,
    validatedVersion.entryBuffer,
  );
  const project = await readProject(context);
  // Reaching ready-to-open with adoptionRequestedAt means a complete,
  // immutable Version already exists.  Do not strand it behind a later change
  // to the old Working Copy: activation only rebinds project authority to the
  // newly created Working Copy and never overwrites those old bytes.  The
  // source precondition remains enforced before Promotion is prepared.

  if (
    !Number.isSafeInteger(transaction.activationDraftRevision)
    || transaction.activationDraftRevision < 0
    || !transaction.activationDraftUpdatedAt
  ) {
    transaction.activationDraftRevision =
      (Number.isSafeInteger(runtime.draft?.draftRevision)
        ? runtime.draft.draftRevision
        : 0) + 1;
    transaction.activationDraftUpdatedAt = nowIso();
    transaction.activationState = "requested";
    await writeTransaction(transactionRoot, transaction);
  }
  const emptyDraftText = jsonText(draftArtifactRecord({
    draftRevision: transaction.activationDraftRevision,
    updatedAt: transaction.activationDraftUpdatedAt,
  }));

  project.latestVersionId = requestedVersionId;
  project.currentBasedOnVersionId = requestedVersionId;
  project.currentExactVersionId = requestedVersionId;
  project.currentHtmlSha256 = workingCopy.source.sha256;
  project.lastModifiedAt = workingCopy.source.lastModifiedAt;
  delete project.restoredFromVersionId;
  await activateProjectSourceRaw(
    context,
    project,
    workingCopy.absolutePath,
  );
  transaction.activationState = "source-activated";
  transaction.sourceActivatedAt ??= nowIso();
  await writeTransaction(transactionRoot, transaction);
  await maybeFailpoint("after-activation-source-committed", transactionRoot);

  await atomicWriteFile(
    path.join(context.projectRoot, "draft", "annotations.json"),
    emptyDraftText,
  );
  await rm(
    path.join(context.projectRoot, "draft", "attachments"),
    { recursive: true, force: true },
  );
  await maybeFailpoint("after-activation-draft-written", transactionRoot);

  runtime.lifecycleState = "ready";
  runtime.activeRun = null;
  runtime.conflict = null;
  runtime.transactionId = null;
  runtime.view = {
    viewMode: "current",
    latestVersionId: requestedVersionId,
    currentBasedOnVersionId: requestedVersionId,
    currentExactVersionId: requestedVersionId,
    viewingVersionId: null,
    renderedContentSha256: workingCopy.source.sha256,
  };
  runtime.autosave = {
    status: "updated",
    expectedSourceSha256: workingCopy.source.sha256,
    lastPersistedAt: nowIso(),
    recoveryLogRelativePath: "recovery/autosave-log.json",
  };
  runtime.draft = {
    annotationsRelativePath: "draft/annotations.json",
    annotationsSha256: sha256(emptyDraftText),
    commentIds: [],
    editEventIds: [],
    draftRevision: transaction.activationDraftRevision,
    updatedAt: transaction.activationDraftUpdatedAt,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
  };
  await writeRuntime(context.projectRoot, runtime);
  transaction.activationState = "runtime-activated";
  await writeTransaction(transactionRoot, transaction);
  await maybeFailpoint("after-activation-runtime-written", transactionRoot);

  transaction.state = "cache-rebuilt";
  transaction.cacheRebuiltAt = nowIso();
  await writeTransaction(transactionRoot, transaction);
  await rm(
    path.join(transactionRoot, "recovery", "source.html"),
    { force: true },
  );
  await maybeFailpoint("after-activation-completed", transactionRoot);
  return {
    ok: true,
    status: "version-activated",
    projectId: context.projectId,
    documentId: context.documentId,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    versionId: requestedVersionId,
    candidateVersionId: requestedVersionId,
    candidateVersionLabel: activeRun.candidateVersionLabel,
    candidateDisplayVersionLabel:
      userVersionLabel(activeRun.candidateVersionOrdinal),
    version: validatedVersion.manifest,
    contentSha256: validatedVersion.contentSha256,
    sourceSha256: workingCopy.source.sha256,
    currentHtmlSha256: workingCopy.source.sha256,
    lastModifiedAt: workingCopy.source.lastModifiedAt,
    committedAt: validatedVersion.committed.committedAt,
    sourcePath: context.sourcePath,
    currentPath: context.sourcePath,
    workingCopyPath: context.sourcePath,
    workingCopyRelativePath: workingCopy.relativePath,
    versionEntryRelativePath:
      `projects/${context.storageDirectoryName}/versions/${requestedVersionId}/files/index.html`,
    versionEntryPath: validatedVersion.entryPath,
  };
}

async function activateReadyVersion(body) {
  const projectFileActivation = await activateProjectFileCandidate(body);
  if (projectFileActivation) return projectFileActivation;
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    // A prior explicit adoption can have completed Promotion before the
    // process stopped.  Recover it before evaluating the caller's request so
    // retrying the action is idempotent and never exposes a hidden Version as
    // an unadopted Candidate.
    await recoverTransactionsRaw(context);
    let runtime = await readRuntime(context);
    let project = await readProject(context);
    const requestedVersionId = cleanText(body.versionId, 100);
    if (!/^ver_\d{4,}$/.test(requestedVersionId)) {
      throw new HttpError(400, "INVALID_VERSION_ID", "versionId is invalid.");
    }
    if (
      ["editing", "ready"].includes(runtime.lifecycleState)
      && !runtime.activeRun
      && project.currentExactVersionId === requestedVersionId
    ) {
      const source = await readSourceFile(context.sourcePath);
      return {
        ok: true,
        status: "version-activated",
        alreadyActivated: true,
        projectId: context.projectId,
        documentId: context.documentId,
        versionId: requestedVersionId,
        sourcePath: context.sourcePath,
        currentPath: context.sourcePath,
        workingCopyPath: context.sourcePath,
        sourceSha256: source.sha256,
        currentHtmlSha256: source.sha256,
        lastModifiedAt: source.lastModifiedAt,
      };
    }
    let activeRun = runtime.activeRun;
    if (
      runtime.lifecycleState !== "ready-to-open"
      || !activeRun
      || activeRun.requestId !== body.requestId
      || activeRun.attemptId !== body.attemptId
      || activeRun.candidateVersionId !== requestedVersionId
    ) {
      throw new HttpError(
        409,
        "READY_VERSION_MISMATCH",
        "This Version is no longer the result waiting to be opened.",
      );
    }
    const transactionId = `txn_${activeRun.requestId}_${activeRun.attemptId}`;
    const transactionRoot = transactionDirectory(context, transactionId);
    const transactionPath = path.join(transactionRoot, "transaction.json");
    let transaction;
    if (!(await exists(transactionPath))) {
      // A v3 Candidate remains only a sealed Request output until the user
      // explicitly adopts it.  Starting this transaction is the Promotion
      // boundary; before this point no Version directory or committed marker
      // exists and latestVersionId remains unchanged.
      const pending = await readPendingCandidateRaw(context, runtime);
      if (!pending) {
        throw new HttpError(
          409,
          "READY_CANDIDATE_MISSING",
          "The ready Candidate no longer has durable review evidence.",
        );
      }
      const currentSource = await readSourceFile(context.sourcePath);
      if (currentSource.sha256 !== activeRun.baseSnapshotSha256) {
        await markAiConflictRaw(
          context,
          runtime,
          pending.validated,
          currentSource.sha256,
        );
        throw new HttpError(
          409,
          "CURRENT_SOURCE_CHANGED_AFTER_VALIDATION",
          "The current HTML changed after Candidate validation. The Candidate remains available but cannot be adopted until the change is resolved.",
          {
            expectedSha256: activeRun.baseSnapshotSha256,
            actualSha256: currentSource.sha256,
          },
        );
      }
      const prepared = await prepareTransactionRaw(
        context,
        runtime,
        pending.validated,
        activeRun.baseSnapshotSha256,
        { adoptionRequestedAt: nowIso() },
      );
      transaction = prepared.transaction;
    } else {
      transaction = await readAuxiliaryJson(
        transactionPath,
        "transaction.json",
      );
    }
    if (
      transaction.projectId !== context.projectId
      || transaction.documentId !== context.documentId
      || transaction.candidateVersionId !== requestedVersionId
    ) {
      throw new HttpError(
        409,
        "READY_TRANSACTION_MISMATCH",
        "The ready Version does not match its committed transaction.",
      );
    }
    transaction = await markTransactionAdoptionRequestedRaw(
      transactionRoot,
      transaction,
    );
    if (transaction.state !== "ready-to-open") {
      const promoted = await continueTransactionRaw(
        context,
        transactionRoot,
        transaction,
      );
      if (promoted.status !== "ready-to-open") {
        throw new HttpError(
          409,
          "CANDIDATE_PROMOTION_NOT_READY",
          "The Candidate Promotion did not reach a ready state.",
          { status: promoted.status },
        );
      }
      transaction = await readAuxiliaryJson(
        transactionPath,
        "transaction.json",
      );
    }
    return completeTransactionActivationRaw(
      context,
      transactionRoot,
      transaction,
    );
  });
}

async function continueTransactionRaw(
  context,
  transactionRoot,
  transaction,
) {
  const runtime = await readRuntime(context);
  const activeRun =
    runtime.activeRun
    ?? activeRunFromTransaction(context, transaction);
  if (!activeRun) {
    throw new HttpError(
      409,
      "TRANSACTION_RUN_MISSING",
      "The transaction no longer has an active run identity.",
    );
  }
  const completionPath = path.join(
    context.projectRoot,
    ...transaction.completionRelativePath.split("/"),
  );
  const transactionCompletion = await readAuxiliaryJson(
    completionPath,
    "completion.json",
  );
  validateCompletionSchema(transactionCompletion);
  if (sha256(await readFile(completionPath)) !== transaction.completionSha256) {
    throw new HttpError(
      409,
      "TRANSACTION_COMPLETION_HASH_MISMATCH",
      "Transaction completion evidence changed after preparation.",
    );
  }
  const preparedVersionRoot = path.join(
    transactionRoot,
    "prepared-version",
  );
  const publishedVersionRoot = path.join(
    context.projectRoot,
    "versions",
    transaction.candidateVersionId,
  );
  const publishedState = [
    "version-published",
    "committed",
    "cache-rebuilt",
  ].includes(transaction.state);
  const artifactRoot = publishedState
    || (!(await exists(preparedVersionRoot))
      && await exists(publishedVersionRoot))
    ? publishedVersionRoot
    : preparedVersionRoot;
  const artifactManifestPath = path.join(artifactRoot, "version.json");
  const artifactEntryPath = path.join(artifactRoot, "files", "index.html");
  const artifactManifestBuffer = await readFile(artifactManifestPath);
  const artifactManifest = JSON.parse(artifactManifestBuffer.toString("utf8"));
  assertLifecycleSchemaVersion(artifactManifest, "version.json");
  const artifactManifestSha256 = sha256(artifactManifestBuffer);
  if (
    artifactManifestSha256 !== transaction.candidateManifestSha256
    && artifactManifestSha256
      !== transaction.pendingCandidateManifestSha256
  ) {
    throw new HttpError(
      409,
      "TRANSACTION_MANIFEST_HASH_MISMATCH",
      "Prepared Version manifest changed during the transaction.",
    );
  }
  if (
    sha256(await readFile(artifactEntryPath))
      !== transaction.candidateContentSha256
  ) {
    throw new HttpError(
      409,
      "TRANSACTION_CONTENT_HASH_MISMATCH",
      "Prepared Version HTML changed during the transaction.",
    );
  }
  if (runtime.lifecycleState !== "recovering-transaction") {
    runtime.lifecycleState = "committing";
  }
  runtime.activeRun = activeRun;
  runtime.activeRun.status = "committing";
  runtime.transactionId = transaction.transactionId;
  await writeRuntime(context.projectRoot, runtime);

  const source = await readSourceFile(context.sourcePath);
  const workingIdentity = workingCopyIdentity(context, transaction);
  if (transaction.state === "prepared") {
    if (
      context.sourcePath === workingIdentity.absolutePath
      && source.sha256 === transaction.candidateContentSha256
    ) {
      transaction.state = "source-applied";
      transaction.sourceAppliedAt ??= nowIso();
      await writeTransaction(transactionRoot, transaction);
    } else if (source.sha256 !== transaction.expectedSourceSha256) {
      const validated = {
        completion: transactionCompletion,
        completionPath: path.join(
          context.projectRoot,
          transaction.completionRelativePath,
        ),
      };
      await markAiConflictRaw(
        context,
        runtime,
        validated,
        source.sha256,
        transaction,
      );
      transaction.state = "awaiting-conflict-resolution";
      transaction.observedSourceSha256 = source.sha256;
      transaction.conflictDetectedAt = nowIso();
      await writeTransaction(transactionRoot, transaction);
      return {
        ok: true,
        status: "awaiting-conflict-resolution",
        conflict: (await readRuntime(context)).conflict,
      };
    } else {
      const preparedBuffer = await readFile(
        path.join(
          transactionRoot,
          "prepared-version",
          "files",
          "index.html",
        ),
      );
      await ensureWorkingCopyRaw(context, transaction, preparedBuffer);
      transaction.state = "source-applied";
      transaction.sourceAppliedAt = nowIso();
      await writeTransaction(transactionRoot, transaction);
      await maybeFailpoint("after-source-applied", transactionRoot);
    }
  }
  if (transaction.state === "source-applied") {
    const preparedBuffer = await readFile(
      path.join(artifactRoot, "files", "index.html"),
    );
    const workingCopy = await ensureWorkingCopyRaw(
      context,
      transaction,
      preparedBuffer,
    );
    if (
      workingCopy.source.sha256 !== transaction.candidateContentSha256
    ) {
      runtime.lifecycleState = "recovering-transaction";
      await writeRuntime(context.projectRoot, runtime);
      throw new HttpError(
        409,
        "TRANSACTION_SOURCE_DIVERGED",
        "The generated working copy changed before Version publication.",
      );
    }
    const projectState = await readLifecycleJson(
      path.join(context.projectRoot, "project.json"),
      "project.json",
    );
    const sourceAlreadyActivated =
      projectState.sourcePath === workingCopy.absolutePath;
    const previousSourcePath = normalizeSourcePath(
      transaction.previousSourcePath ?? context.sourcePath,
    );
    if (
      !sourceAlreadyActivated
      && previousSourcePath !== workingCopy.absolutePath
    ) {
      const previousSource = await readSourceFile(previousSourcePath);
      if (previousSource.sha256 !== transaction.expectedSourceSha256) {
        const validated = {
          completion: transactionCompletion,
          completionPath,
        };
        await markAiConflictRaw(
          context,
          runtime,
          validated,
          previousSource.sha256,
          transaction,
        );
        transaction.state = "awaiting-conflict-resolution";
        transaction.observedSourceSha256 = previousSource.sha256;
        transaction.conflictDetectedAt = nowIso();
        await writeTransaction(transactionRoot, transaction);
        return {
          ok: true,
          status: "awaiting-conflict-resolution",
          conflict: (await readRuntime(context)).conflict,
        };
      }
    }
    const finalVersionRoot = publishedVersionRoot;
    if (!(await exists(finalVersionRoot))) {
      await rename(preparedVersionRoot, finalVersionRoot);
      await syncDirectory(path.dirname(finalVersionRoot));
    } else {
      const existingManifest = await readLifecycleJson(
        path.join(finalVersionRoot, "version.json"),
        `${transaction.candidateVersionId}/version.json`,
      );
      if (
        existingManifest.requestId !== transaction.requestId
        || existingManifest.attemptId !== transaction.attemptId
      ) {
        throw new HttpError(
          409,
          "VERSION_ID_COLLISION",
          "The candidate Version ID belongs to another run.",
        );
      }
    }
    transaction.state = "version-published";
    transaction.versionPublishedAt = nowIso();
    await writeTransaction(transactionRoot, transaction);
    await maybeFailpoint("after-version-published", transactionRoot);
  }
  if (transaction.state === "version-published") {
    const finalVersionRoot = publishedVersionRoot;
    const generatedAt = await prepareCommitManifestRaw(
      transactionRoot,
      transaction,
      finalVersionRoot,
    );
    const committedMarker = await createCommittedMarker(
      finalVersionRoot,
      transaction.candidateVersionId,
      transaction.candidateContentSha256,
      {
        transactionId: transaction.transactionId,
        completionSha256: transaction.completionSha256,
        committedAt: generatedAt,
      },
    );
    transaction.state = "committed";
    transaction.committedAt = committedMarker.committedAt;
    await writeTransaction(transactionRoot, transaction);
    await maybeFailpoint("after-committed", transactionRoot);
  }
  if (
    transaction.state === "committed"
    || transaction.state === "ready-to-open"
    || transaction.state === "cache-rebuilt"
  ) {
    return finalizeCommittedTransactionRaw(
      context,
      transactionRoot,
      transaction,
    );
  }
  throw new HttpError(
    500,
    "UNKNOWN_TRANSACTION_STATE",
    `Unsupported transaction state ${transaction.state}.`,
  );
}

async function recoverTransactionsRaw(context) {
  const transactionsRoot = path.join(context.projectRoot, "transactions");
  if (!(await exists(transactionsRoot))) return [];
  const transactionIds = await listIds(transactionsRoot, /^txn_.+$/);
  const recovered = [];
  for (const transactionId of transactionIds) {
    const transactionRoot = path.join(transactionsRoot, transactionId);
    const transactionPath = path.join(transactionRoot, "transaction.json");
    if (!(await exists(transactionPath))) continue;
    const transaction = await readAuxiliaryJson(
      transactionPath,
      "transaction.json",
    );
    if (["cache-rebuilt", "aborted"].includes(transaction.state)) {
      continue;
    }
    if (transaction.state === "awaiting-conflict-resolution") continue;
    // Transactions created before the explicit-adoption marker are retained as
    // reviewable Candidates.  They must not become Versions merely because the
    // application restarted.
    if (
      transaction.state === "ready-to-open"
      && !transaction.adoptionRequestedAt
    ) {
      continue;
    }
    const runtime = await readRuntime(context);
    runtime.lifecycleState = "recovering-transaction";
    runtime.activeRun ??= activeRunFromTransaction(context, transaction);
    runtime.transactionId = transaction.transactionId;
    await writeRuntime(context.projectRoot, runtime);
    try {
      if (transaction.state === "ready-to-open") {
        recovered.push(
          await completeTransactionActivationRaw(
            context,
            transactionRoot,
            transaction,
          ),
        );
        continue;
      }
      const promoted = await continueTransactionRaw(
        context,
        transactionRoot,
        transaction,
      );
      const refreshed = await readAuxiliaryJson(
        transactionPath,
        "transaction.json",
      );
      if (
        refreshed.state === "ready-to-open"
        && refreshed.adoptionRequestedAt
      ) {
        recovered.push(
          await completeTransactionActivationRaw(
            context,
            transactionRoot,
            refreshed,
          ),
        );
      } else {
        recovered.push(promoted);
      }
    } catch (error) {
      const latestRuntime = await readRuntime(context);
      latestRuntime.lifecycleState = "recovering-transaction";
      latestRuntime.transactionId = transaction.transactionId;
      await writeRuntime(context.projectRoot, latestRuntime);
      throw error;
    }
  }
  return recovered;
}

async function statusFor(sourcePath, requestId, attemptId = "attempt_001") {
  const projectFileStatus = await projectFileRequestStatus(
    sourcePath,
    requestId,
    attemptId,
  );
  if (projectFileStatus) return projectFileStatus;
  const context = await loadContextBySource(sourcePath, false);
  return withProjectMutation(context, async () => {
    const recovered = await recoverTransactionsRaw(context);
    const recoveredMatch = recovered.find(
      (item) =>
        item?.requestId === requestId && item?.attemptId === attemptId,
    );
    if (
      recoveredMatch?.status === "version-created"
      || recoveredMatch?.status === "version-activated"
    ) {
      return recoveredMatch;
    }
    const requestRoot = path.join(context.projectRoot, "requests", requestId);
    const attemptRoot = path.join(requestRoot, "attempts", attemptId);
    if (!(await exists(attemptRoot))) {
      throw new HttpError(404, "ATTEMPT_NOT_FOUND", "Attempt was not found.");
    }
    const completionPath = path.join(attemptRoot, "completion.json");
    const outcomePath = path.join(requestRoot, "outcome.json");
    if (await exists(outcomePath)) {
      const outcome = await readAuxiliaryJson(outcomePath, "outcome.json");
      if (outcome.status === "version-created") {
        const validatedVersion = await validateCommittedVersionRaw(
          context,
          outcome.versionId,
        );
        const {
          versionRoot,
          manifest: version,
          committed,
        } = validatedVersion;
        if (validatedVersion.contentSha256 !== outcome.contentSha256) {
          throw new HttpError(
            409,
            "OUTCOME_VERSION_HASH_MISMATCH",
            "Outcome content hash does not match its committed Version.",
          );
        }
        const outcomeRuntime = await readRuntime(context);
        const outcomeProject = await readProject(context);
        const activeSource = await readSourceFile(context.sourcePath);
        const outcomeAlreadyActivated = (
          !outcomeRuntime.activeRun
          && outcomeProject.currentExactVersionId === outcome.versionId
          && outcomeProject.currentHtmlSha256 === activeSource.sha256
        );
        if (
          !outcomeAlreadyActivated
          && outcomeRuntime.lifecycleState === "ready-to-open"
          && outcomeRuntime.activeRun?.requestId === requestId
          && outcomeRuntime.activeRun?.attemptId === attemptId
          && outcomeRuntime.activeRun?.candidateVersionId === outcome.versionId
        ) {
          const transactionId = `txn_${requestId}_${attemptId}`;
          const transaction = await readAuxiliaryJson(
            path.join(
              transactionDirectory(context, transactionId),
              "transaction.json",
            ),
            "transaction.json",
          );
          if (transaction.state !== "ready-to-open") {
            throw new HttpError(
              409,
              "READY_TRANSACTION_MISMATCH",
              "The ready Version does not match its transaction state.",
            );
          }
          const workingCopy = await ensureWorkingCopyRaw(
            context,
            transaction,
            validatedVersion.entryBuffer,
          );
          const completion = await readAuxiliaryJson(
            path.join(attemptRoot, "completion.json"),
            "completion.json",
          );
          const reviewPath = path.join(attemptRoot, "validation-review.json");
          const validationReview = await exists(reviewPath)
            ? await readAuxiliaryJson(reviewPath, "validation-review.json")
            : null;
          const assessmentPath = path.join(
            attemptRoot,
            "candidate-assessment.json",
          );
          const candidateAssessment = await exists(assessmentPath)
            ? await readCandidateAssessment(
                assessmentPath,
                {
                  projectId: context.projectId,
                  documentId: context.documentId,
                  requestId,
                  attemptId,
                  candidateVersionId: outcome.versionId,
                  outputSha256: outcome.contentSha256,
                },
              )
            : null;
          const supplement = await validateAttemptSupplement(context, {
            requestId,
            attemptId,
            attemptRoot,
            requireSealed: true,
          });
          return {
            ok: true,
            status: "ready-to-open",
            readyToOpen: true,
            projectId: context.projectId,
            documentId: context.documentId,
            sourcePath: context.sourcePath,
            requestId,
            attemptId,
            versionId: outcome.versionId,
            candidateVersionId: outcome.versionId,
            candidateVersionLabel: version.versionLabel,
            candidateDisplayVersionLabel:
              userVersionLabel(version.versionOrdinal),
            version,
            completion: { completedAt: completion.completedAt },
            outcome,
            contentSha256: outcome.contentSha256,
            sourceSha256: activeSource.sha256,
            currentHtmlSha256: activeSource.sha256,
            lastModifiedAt: activeSource.lastModifiedAt,
            committedAt: committed.committedAt,
            activeRun: {
              ...outcomeRuntime.activeRun,
              sourcePath: context.sourcePath,
              status: "ready-to-open",
            },
            currentPath: context.sourcePath,
            workingCopyPath: workingCopy.absolutePath,
            workingCopyRelativePath: workingCopy.relativePath,
            versionEntryRelativePath:
              `projects/${context.storageDirectoryName}/versions/${outcome.versionId}/files/index.html`,
            versionEntryPath: validatedVersion.entryPath,
            supplement,
            ...(validationReview ? { validationReview } : {}),
            ...(candidateAssessment ? { candidateAssessment } : {}),
          };
        }
        const source = activeSource;
        let protocolViolation = null;
        let completion = null;
        if (await exists(completionPath)) {
          completion = await readAuxiliaryJson(
            completionPath,
            "completion.json",
          );
          const transactionId = `txn_${requestId}_${attemptId}`;
          const transaction = await readAuxiliaryJson(
            path.join(
              transactionDirectory(context, transactionId),
              "transaction.json",
            ),
            "transaction.json",
          );
          if (
            transaction.requestId !== requestId
            || transaction.attemptId !== attemptId
            || transaction.candidateVersionId !== outcome.versionId
          ) {
            protocolViolation = {
              code: "OUTPUT_PATH_IDENTITY_MISMATCH",
              expectedRequestId: requestId,
              actualRequestId: transaction.requestId,
              expectedAttemptId: attemptId,
              actualAttemptId: transaction.attemptId,
              expectedVersionId: outcome.versionId,
              actualVersionId: transaction.candidateVersionId,
              detectedAt: nowIso(),
            };
          } else {
            const { attemptOutputRelativePath } =
              outputPathIdentityFromTransaction(transaction);
            if (completion.outputRelativePath !== attemptOutputRelativePath) {
              protocolViolation = {
                code: "OUTPUT_PATH_IDENTITY_MISMATCH",
                expectedOutputRelativePath: attemptOutputRelativePath,
                actualOutputRelativePath: completion.outputRelativePath,
                detectedAt: nowIso(),
              };
            } else {
              const outputPath = path.join(
                attemptRoot,
                ...attemptOutputRelativePath.split("/"),
              );
              const outputSha256 = (await exists(outputPath))
                ? sha256(await readFile(outputPath))
                : null;
              if (outputSha256 !== completion.outputSha256) {
                protocolViolation = {
                  code: "OUTPUT_MUTATED_AFTER_FINALIZATION",
                  expectedSha256: completion.outputSha256,
                  actualSha256: outputSha256,
                  detectedAt: nowIso(),
                };
              }
            }
          }
        }
        return {
          ok: true,
          status: outcomeAlreadyActivated
            ? "version-activated"
            : "version-created",
          ...(outcomeAlreadyActivated ? { alreadyActivated: true } : {}),
          projectId: context.projectId,
          documentId: context.documentId,
          sourcePath: context.sourcePath,
          requestId,
          attemptId,
          versionId: outcome.versionId,
          candidateVersionId: outcome.versionId,
          candidateVersionLabel: version.versionLabel,
          candidateDisplayVersionLabel:
            userVersionLabel(version.versionOrdinal),
          version,
          completion: completion
            ? { completedAt: completion.completedAt }
            : null,
          outcome,
          contentSha256: outcome.contentSha256,
          sourceSha256: source.sha256,
          currentHtmlSha256: source.sha256,
          lastModifiedAt: source.lastModifiedAt,
          committedAt: committed.committedAt,
          protocolViolation,
          versionEntryRelativePath:
            `projects/${context.storageDirectoryName}/versions/${outcome.versionId}/files/index.html`,
          versionEntryPath: path.join(
            versionRoot,
            "files",
            "index.html",
          ),
          currentPath: context.sourcePath,
          workingCopyPath: context.sourcePath,
        };
      }
      return {
        ok: true,
        requestId,
        attemptId,
        ...outcome,
        completionObserved: await exists(completionPath),
      };
    }
    if (await exists(path.join(attemptRoot, "cancelled.json"))) {
      return {
        ok: true,
        status: "cancelled",
        requestId,
        attemptId,
      };
    }
    // Status polling needs lifecycle identity first. Frozen display artifacts
    // are validated only when they are actually consumed for completion.
    let runtime = await readRuntime(context, { hydrateArtifacts: false });
    if (
      runtime.lifecycleState === "ready-to-open"
      && runtime.activeRun?.requestId === requestId
      && runtime.activeRun?.attemptId === attemptId
    ) {
      const pending = await readPendingCandidateRaw(context, runtime);
      if (pending) return pendingCandidateReadyPayload(context, runtime, pending);
    }
    if (
      !runtime.activeRun
      || runtime.activeRun.requestId !== requestId
      || runtime.activeRun.attemptId !== attemptId
    ) {
      throw new HttpError(
        409,
        "ACTIVE_RUN_MISMATCH",
        "Request is not the active project run.",
      );
    }
    if (runtime.lifecycleState === "awaiting-conflict-resolution") {
      return {
        ok: true,
        status: "awaiting-conflict-resolution",
        requestId,
        attemptId,
        conflict: runtime.conflict,
        activeRun: runtime.activeRun,
      };
    }
    let validated;
    try {
      if (!(await exists(completionPath))) {
        // The protocol surface is independent of frozen annotations and must
        // still reject unauthorized output while a completion is absent.
        const changeRequest = await readLifecycleJson(
          path.join(requestRoot, "change-request.json"),
          "change-request.json",
        );
        const outputRelativePath = await outputRelativePathForActiveRun(
          context,
          runtime.activeRun,
          changeRequest,
        );
        await assertAttemptProtocolSurfaceRaw(attemptRoot, outputRelativePath);
        validated = {
          waiting: true,
          requestRoot,
          attemptRoot,
          completionPath,
        };
      } else {
        // Completion consumes the frozen contract, so only this branch
        // hydrates and validates those artifacts strictly.
        runtime = await readRuntime(context);
        validated = await validateCompletionRaw(context, runtime);
      }
    } catch (error) {
      if (error?.code === "UNSUPPORTED_SCHEMA_VERSION") throw error;
      const protocolViolationCodes = new Set([
        "COMPLETION_SCHEMA_INVALID",
        "COMPLETION_IDENTITY_MISMATCH",
        "OUTPUT_HASH_MISMATCH",
        "BASE_SNAPSHOT_HASH_MISMATCH",
        "COMPARISON_HASH_MISMATCH",
        "INPUT_MANIFEST_HASH_MISMATCH",
        "FROZEN_INPUT_HASH_MISMATCH",
        "FROZEN_INPUT_FILE_MISSING",
        "UNEXPECTED_ATTEMPT_OUTPUT",
        "UNEXPECTED_OUTPUT_FILE",
        "OUTPUT_PROTOCOL_VIOLATION",
        "OUTPUT_PATH_IDENTITY_MISMATCH",
        "OUTPUT_MANAGED_META_MISMATCH",
      ]);
      const protocolViolation = protocolViolationCodes.has(error?.code)
        ? {
            code: error.code,
            message:
              error instanceof Error
                ? error.message
                : "Attempt output violated the frozen protocol.",
            detectedAt: nowIso(),
          }
        : null;
      const outcome = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        status: "error",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        candidateVersionId: runtime.activeRun.candidateVersionId,
        error: {
          code: error?.code ?? "COMPLETION_VALIDATION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Completion validation failed.",
          ...(error?.details === undefined ? {} : { details: error.details }),
        },
        ...(protocolViolation ? { protocolViolation } : {}),
        completedAt: nowIso(),
      };
      await archiveAttemptOutcomeRaw(context, runtime.activeRun, outcome);
      runtime.lifecycleState = "editing";
      runtime.activeRun = null;
      runtime.conflict = null;
      runtime.lastCompleted = outcome;
      await writeRuntime(context.projectRoot, runtime);
      return {
        ok: true,
        ...outcome,
        completionObserved: await exists(completionPath),
      };
    }
    if (validated.waiting) {
      return {
        ok: true,
        status: "waiting",
        waitingReason: "awaiting-mandatory-completion",
        requestId,
        attemptId,
        activeRun: runtime.activeRun,
      };
    }
    runtime.lifecycleState = "validating";
    runtime.activeRun.status = "validating";
    runtime.activeRun.updatedAt = nowIso();
    await writeRuntime(context.projectRoot, runtime);
    if (
      validated.completion.baseComparisonSha256
      === validated.completion.outputComparisonSha256
    ) {
      const outcome = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        status: "no-change",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        candidateVersionId: runtime.activeRun.candidateVersionId,
        completedAt: nowIso(),
      };
      await archiveAttemptOutcomeRaw(context, runtime.activeRun, outcome);
      runtime.lifecycleState = "editing";
      runtime.activeRun = null;
      runtime.conflict = null;
      runtime.lastCompleted = outcome;
      await writeRuntime(context.projectRoot, runtime);
      return { ok: true, ...outcome, completionObserved: true };
    }

    let assessed;
    try {
      assessed = await writeCandidateAssessmentRaw(
        context,
        runtime,
        validated,
      );
    } catch (error) {
      const outcome = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        status: "error",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        candidateVersionId: runtime.activeRun.candidateVersionId,
        error: {
          code: error?.code ?? "CANDIDATE_ASSESSMENT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Candidate assessment failed.",
          ...(error?.details === undefined ? {} : { details: error.details }),
        },
        completedAt: nowIso(),
      };
      await archiveAttemptOutcomeRaw(context, runtime.activeRun, outcome);
      runtime.lifecycleState = "editing";
      runtime.activeRun = null;
      runtime.conflict = null;
      runtime.lastCompleted = outcome;
      await writeRuntime(context.projectRoot, runtime);
      return { ok: true, ...outcome, completionObserved: true };
    }
    if (assessed.assessment.status === "blocked") {
      const issueCode = assessed.assessment.issueCodes[0]
        ?? "CANDIDATE_UNUSABLE";
      const outcome = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        status: "error",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId,
        attemptId,
        candidateVersionId: runtime.activeRun.candidateVersionId,
        error: {
          code: issueCode,
          message: "The candidate HTML could not be safely adopted.",
        },
        completedAt: nowIso(),
      };
      await archiveAttemptOutcomeRaw(context, runtime.activeRun, outcome);
      runtime.lifecycleState = "editing";
      runtime.activeRun = null;
      runtime.conflict = null;
      runtime.lastCompleted = outcome;
      await writeRuntime(context.projectRoot, runtime);
      return {
        ok: true,
        ...outcome,
        completionObserved: true,
        candidateAssessment: assessed.assessment,
      };
    }
    const pending = await writePendingCandidateRaw(context, runtime, validated);
    runtime.lifecycleState = "ready-to-open";
    runtime.activeRun.status = "ready-to-open";
    runtime.activeRun.updatedAt = nowIso();
    runtime.transactionId = null;
    runtime.conflict = null;
    runtime.lastCompleted = {
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
      status: "candidate-ready",
      projectId: context.projectId,
      documentId: context.documentId,
      requestId,
      attemptId,
      candidateVersionId: runtime.activeRun.candidateVersionId,
      contentSha256: pending.candidate.outputSha256,
      completedAt: validated.completion.completedAt,
      generatedAt: pending.candidate.createdAt,
    };
    await writeRuntime(context.projectRoot, runtime);
    return pendingCandidateReadyPayload(context, runtime, {
      ...pending,
      validationReview: await exists(path.join(
        validated.attemptRoot,
        "validation-review.json",
      ))
        ? await readAuxiliaryJson(
          path.join(validated.attemptRoot, "validation-review.json"),
          "validation-review.json",
        )
        : null,
      candidateAssessment: assessed.assessment,
    });
  });
}

async function cancelActiveRun(body) {
  const projectFileCancellation = await cancelProjectFileRequest(body);
  if (projectFileCancellation) return projectFileCancellation;
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    // Cancellation only needs the durable lifecycle identity. Corrupt display
    // artifacts must never strand a project in a locked state.
    const runtime = await readRuntime(context, { hydrateArtifacts: false });
    const activeRun = runtime.activeRun;
    if (!activeRun) {
      const archivedOutcomePath = body.requestId
        ? path.join(
            context.projectRoot,
            "requests",
            body.requestId,
            "outcome.json",
          )
        : null;
      const terminal = runtime.lastCompleted ?? (
        archivedOutcomePath && await exists(archivedOutcomePath)
          ? await readAuxiliaryJson(archivedOutcomePath, "outcome.json")
          : null
      );
      if (
        body.requestId
        && body.attemptId
        && terminal?.requestId === body.requestId
        && terminal?.attemptId === body.attemptId
        && runtime.lifecycleState === "editing"
      ) {
        return {
          ok: true,
          status: "already-inactive",
          projectId: context.projectId,
          documentId: context.documentId,
          requestId: body.requestId,
          attemptId: body.attemptId,
          terminalStatus: terminal.status,
        };
      }
      throw new HttpError(404, "ACTIVE_RUN_NOT_FOUND", "No active run exists.");
    }
    if (
      body.requestId && body.requestId !== activeRun.requestId
      || body.attemptId && body.attemptId !== activeRun.attemptId
    ) {
      throw new HttpError(
        409,
        "ACTIVE_RUN_MISMATCH",
        "Cancellation identity does not match the active run.",
      );
    }
    if (
      ["committing", "recovering-transaction"].includes(runtime.lifecycleState)
      && runtime.transactionId
    ) {
      const transaction = await readAuxiliaryJson(
        path.join(
          transactionDirectory(context, runtime.transactionId),
          "transaction.json",
        ),
        "transaction.json",
      );
      if (
        ["source-applied", "version-published", "committed"].includes(
          transaction.state,
        )
      ) {
        throw new HttpError(
          409,
          "RUN_NOT_CANCELLABLE",
          "The source has already been applied; transaction recovery must finish.",
        );
      }
      transaction.state = "aborted";
      transaction.abortedAt = nowIso();
      transaction.abortReason = "cancelled-before-source-application";
      await writeTransaction(
        transactionDirectory(context, runtime.transactionId),
        transaction,
      );
      await removeUnactivatedWorkingCopyRaw(context, transaction);
    }
    const attemptRoot = path.join(
      context.projectRoot,
      "requests",
      activeRun.requestId,
      "attempts",
      activeRun.attemptId,
    );
    const cancellation = {
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
      projectId: context.projectId,
      documentId: context.documentId,
      requestId: activeRun.requestId,
      attemptId: activeRun.attemptId,
      status: "cancelled",
      reason: cleanText(body.reason, 1000) || "cancelled-by-user",
      cancelledAt: nowIso(),
    };
    await atomicWriteJson(
      path.join(attemptRoot, "cancelled.json"),
      cancellation,
    );
    await archiveAttemptOutcomeRaw(context, activeRun, cancellation);
    runtime.lifecycleState = "editing";
    runtime.activeRun = null;
    runtime.conflict = null;
    runtime.transactionId = null;
    runtime.lastCompleted = cancellation;
    await writeRuntime(context.projectRoot, runtime);
    return {
      ok: true,
      status: "cancelled",
      requestId: activeRun.requestId,
      attemptId: activeRun.attemptId,
      activeRun: null,
      cancellation,
    };
  });
}

async function resolveConflict(body) {
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    const runtime = await readRuntime(context);
    const conflict = runtime.conflict;
    if (!conflict) {
      throw new HttpError(404, "CONFLICT_NOT_FOUND", "No active conflict exists.");
    }
    const action = cleanText(body.action, 80);
    const source = await readSourceFile(context.sourcePath);
    if (action === "keep-external" || action === "reload-external") {
      let transactionRoot = null;
      let transaction = null;
      if (runtime.transactionId) {
        transactionRoot = transactionDirectory(
          context,
          runtime.transactionId,
        );
        if (await exists(path.join(transactionRoot, "transaction.json"))) {
          transaction = await readAuxiliaryJson(
            path.join(transactionRoot, "transaction.json"),
            "transaction.json",
          );
        }
      }
      const project = await readProject(context);
      project.currentHtmlSha256 = source.sha256;
      project.currentExactVersionId = await exactVersionForHash(
        context,
        source.sha256,
      );
      project.lastModifiedAt = source.lastModifiedAt;
      await writeProject(context, project);
      await syncCurrentSourceIdentity(context, source);
      if (transaction) {
        transaction.state = "aborted";
        transaction.abortedAt = nowIso();
        transaction.abortReason = "external-source-kept";
        await writeTransaction(transactionRoot, transaction);
        await removeUnactivatedWorkingCopyRaw(context, transaction);
      }
      const outcome = {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        status: "conflict-kept-external",
        projectId: context.projectId,
        documentId: context.documentId,
        requestId: runtime.activeRun?.requestId ?? null,
        attemptId: runtime.activeRun?.attemptId ?? null,
        sourceSha256: source.sha256,
        completedAt: nowIso(),
      };
      if (runtime.activeRun) {
        await archiveAttemptOutcomeRaw(
          context,
          runtime.activeRun,
          outcome,
        );
      }
      runtime.lifecycleState = "editing";
      runtime.activeRun = null;
      runtime.conflict = null;
      runtime.transactionId = null;
      runtime.pendingWrite = null;
      runtime.view = {
        viewMode: "current",
        latestVersionId: project.latestVersionId,
        currentBasedOnVersionId: project.currentBasedOnVersionId,
        currentExactVersionId: project.currentExactVersionId,
        viewingVersionId: null,
        renderedContentSha256: source.sha256,
      };
      runtime.autosave = {
        status: "updated",
        expectedSourceSha256: source.sha256,
        lastPersistedAt: nowIso(),
        recoveryLogRelativePath: "recovery/autosave-log.json",
      };
      runtime.lastCompleted = outcome;
      await writeRuntime(context.projectRoot, runtime);
      return { ok: true, ...outcome, versionCreated: false };
    }
    if (action !== "adopt-ai") {
      throw new HttpError(
        400,
        "INVALID_CONFLICT_ACTION",
        "action must be adopt-ai or keep-external.",
      );
    }
    if (conflict.type !== "ai-source" || !runtime.activeRun) {
      throw new HttpError(
        409,
        "CONFLICT_ACTION_NOT_ALLOWED",
        "adopt-ai is only valid for an AI source conflict.",
      );
    }
    const confirmedSourceSha256 = requireSha256(
      body.confirmedSourceSha256 ?? conflict.externalSourceSha256,
      "confirmedSourceSha256",
    );
    if (source.sha256 !== confirmedSourceSha256) {
      conflict.externalSourceSha256 = source.sha256;
      conflict.detectedAt = nowIso();
      runtime.conflict = conflict;
      await writeRuntime(context.projectRoot, runtime);
      throw new HttpError(
        409,
        "SOURCE_CHANGED_AGAIN",
        "The external source changed again; confirm the new content first.",
        conflict,
      );
    }
    let existingTransactionRoot = null;
    let existingTransaction = null;
    if (runtime.transactionId) {
      existingTransactionRoot = transactionDirectory(
        context,
        runtime.transactionId,
      );
      existingTransaction = await readAuxiliaryJson(
        path.join(existingTransactionRoot, "transaction.json"),
        "transaction.json",
      );
    }
    runtime.lifecycleState = "validating";
    runtime.activeRun.status = "validating";
    runtime.conflict = null;
    await writeRuntime(context.projectRoot, runtime);
    const validated = await validateCompletionRaw(context, runtime);
    if (validated.waiting) {
      throw new HttpError(
        409,
        "COMPLETION_NOT_FOUND",
        "The finalized AI candidate is no longer available.",
      );
    }
    let prepared;
    if (existingTransaction) {
      existingTransaction.expectedSourceSha256 = source.sha256;
      existingTransaction.state = "prepared";
      existingTransaction.confirmedExternalSha256 = source.sha256;
      existingTransaction.conflictConfirmedAt = nowIso();
      await atomicWriteFile(
        path.join(existingTransactionRoot, "recovery", "source.html"),
        source.buffer,
      );
      await writeTransaction(existingTransactionRoot, existingTransaction);
      prepared = {
        transactionRoot: existingTransactionRoot,
        transaction: existingTransaction,
      };
    } else {
      prepared = await prepareTransactionRaw(
        context,
        runtime,
        validated,
        source.sha256,
      );
    }
    return continueTransactionRaw(
      context,
      prepared.transactionRoot,
      prepared.transaction,
    );
  });
}

async function pendingCandidateVersionFile(context, requestedVersionId) {
  const runtime = await readRuntime(context);
  if (
    runtime.lifecycleState !== "ready-to-open"
    || !runtime.activeRun
    || runtime.activeRun.candidateVersionId !== requestedVersionId
  ) return null;
  const pending = await readPendingCandidateRaw(context, runtime);
  if (!pending) return null;
  const buffer = pending.validated.outputBuffer;
  return {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    storageDirectoryName: context.storageDirectoryName,
    versionId: requestedVersionId,
    content: buffer.toString("utf8"),
    sha256: pending.candidate.outputSha256,
    contentSha256: pending.candidate.outputSha256,
    path: pending.validated.outputPath,
    relativePath: pending.candidate.outputRelativePath,
    readOnly: true,
    candidate: true,
  };
}

async function versionFile(sourcePath, versionId) {
  const projectFileVersion = await projectFileVersionFile(sourcePath, versionId);
  if (projectFileVersion) return projectFileVersion;
  const context = await loadContextBySource(sourcePath, false);
  if (!/^ver_\d{4,}$/.test(versionId ?? "")) {
    throw new HttpError(400, "INVALID_VERSION_ID", "versionId is invalid.");
  }
  const pendingCandidate = await pendingCandidateVersionFile(context, versionId);
  if (pendingCandidate) return pendingCandidate;
  const versionRoot = path.join(context.projectRoot, "versions", versionId);
  if (!(await exists(path.join(versionRoot, "committed.json")))) {
    throw new HttpError(
      404,
      "VERSION_NOT_FOUND",
      "The requested Version does not belong to this project.",
    );
  }
  const validatedVersion = await validateCommittedVersionRaw(
    context,
    versionId,
  );
  const { entryPath, entryBuffer: buffer } = validatedVersion;
  return {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    storageDirectoryName: context.storageDirectoryName,
    versionId,
    content: buffer.toString("utf8"),
    sha256: sha256(buffer),
    contentSha256: sha256(buffer),
    path: entryPath,
    relativePath:
      `projects/${context.storageDirectoryName}/versions/${versionId}/files/index.html`,
    readOnly: true,
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

async function sourceFile(sourcePath, { projectStorageVersion = "" } = {}) {
  const projectFileSource = await sourceProjectFile(sourcePath);
  if (projectFileSource) return projectFileSource;
  if (projectStorageVersion === "4.0.0") {
    return unmanagedSourceFile(sourcePath);
  }
  let context;
  try {
    context = await loadContextBySource(sourcePath, false);
  } catch (error) {
    if (error?.code !== "PROJECT_NOT_FOUND") throw error;
    return unmanagedSourceFile(sourcePath);
  }
  const source = await readSourceFile(context.sourcePath);
  const project = await readProject(context);
  return {
    ok: true,
    registered: true,
    projectId: context.projectId,
    documentId: context.documentId,
    storageDirectoryName: context.storageDirectoryName,
    sourcePath: context.sourcePath,
    content: source.html,
    sha256: source.sha256,
    sourceSha256: source.sha256,
    currentBasedOnVersionId: project.currentBasedOnVersionId,
    currentExactVersionId: await exactVersionForHash(context, source.sha256),
    restoredFromVersionId: project.restoredFromVersionId ?? null,
    lastModifiedAt: source.lastModifiedAt,
  };
}

function safeInspectableProjectPath(context, relativePath) {
  const normalized = cleanText(relativePath, 500).replaceAll("\\", "/");
  const allowed = new Set([
    "PROJECT.md",
    "runtime-state.json",
    "edit-audit.jsonl",
  ]);
  const requestFilePattern =
    /^requests\/req_[A-Za-z0-9_-]+\/(?:PROMPT\.md|change-request\.json|input-manifest\.json|input\/AI_RULES\.md)$/;
  if (!allowed.has(normalized) && !requestFilePattern.test(normalized)) {
    throw new HttpError(
      403,
      "PROJECT_FILE_NOT_INSPECTABLE",
      "The requested project file is not available in the read-only inspector.",
    );
  }
  const resolved = path.resolve(context.projectRoot, normalized);
  if (
    resolved !== context.projectRoot
    && !resolved.startsWith(`${context.projectRoot}${path.sep}`)
  ) {
    throw new HttpError(400, "INVALID_PROJECT_FILE_PATH", "Project file path escapes its project.");
  }
  return { normalized, resolved };
}

async function inspectProjectFile(sourcePath, relativePath) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(sourcePath);
  if (projectFileWorkspace) {
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
  const context = await loadContextBySource(sourcePath, false);
  const inspected = safeInspectableProjectPath(context, relativePath);
  let information;
  try {
    information = await stat(inspected.resolved);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(404, "PROJECT_FILE_NOT_FOUND", "The project file does not exist yet.");
    }
    throw error;
  }
  if (!information.isFile() || information.size > MAX_FILE_BYTES) {
    throw new HttpError(413, "PROJECT_FILE_UNREADABLE", "The project file cannot be inspected.");
  }
  const buffer = await readFile(inspected.resolved);
  return {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
    relativePath: inspected.normalized,
    path: inspected.resolved,
    content: buffer.toString("utf8"),
    sha256: sha256(buffer),
    readOnly: inspected.normalized !== "PROJECT.md",
    updatedAt: information.mtime.toISOString(),
  };
}

async function autosaveConflictCandidate(sourcePath) {
  const context = await loadContextBySource(sourcePath, false);
  const runtime = await readRuntime(context);
  const conflict = runtime.conflict;
  if (!conflict) {
    throw new HttpError(
      404,
      "AUTOSAVE_CONFLICT_NOT_FOUND",
      "No conflict candidate exists.",
    );
  }
  const isAutosaveConflict = conflict.type === "autosave-source";
  const candidateRelativePath = isAutosaveConflict
    ? conflict.candidateRecoveryRelativePath
    : conflict.type === "ai-source"
      ? conflict.candidateRelativePath
      : null;
  const expectedCandidateSha256 = isAutosaveConflict
    ? conflict.candidateContentSha256
    : conflict.candidateOutputSha256;
  if (!candidateRelativePath || !expectedCandidateSha256) {
    throw new HttpError(
      404,
      "CONFLICT_CANDIDATE_NOT_FOUND",
      "No readable conflict candidate exists.",
    );
  }
  const resolved = path.resolve(
    context.projectRoot,
    ...candidateRelativePath.split("/"),
  );
  if (!resolved.startsWith(`${context.projectRoot}${path.sep}`)) {
    throw new HttpError(409, "INVALID_CONFLICT_CANDIDATE", "Conflict candidate path is invalid.");
  }
  const information = await lstat(resolved).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new HttpError(
        404,
        "CONFLICT_CANDIDATE_NOT_FOUND",
        "The preserved conflict candidate is missing.",
      );
    }
    throw error;
  });
  if (
    information.isSymbolicLink()
    || !information.isFile()
    || information.size > MAX_FILE_BYTES
  ) {
    throw new HttpError(
      409,
      "INVALID_CONFLICT_CANDIDATE",
      "The preserved conflict candidate must be a regular HTML file.",
    );
  }
  const buffer = await readFile(resolved);
  const candidateSha256 = sha256(buffer);
  if (candidateSha256 !== expectedCandidateSha256) {
    throw new HttpError(
      409,
      "CONFLICT_CANDIDATE_HASH_MISMATCH",
      "The preserved conflict candidate no longer matches the conflict record.",
    );
  }
  requireCompleteHtml(buffer.toString("utf8"), "conflict candidate");
  const common = {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
    conflictId: conflict.conflictId,
    type: conflict.type,
    content: buffer.toString("utf8"),
    sha256: candidateSha256,
    expectedSourceSha256: conflict.expectedSourceSha256,
    externalSourceSha256: conflict.externalSourceSha256,
    detectedAt: conflict.detectedAt,
  };
  if (isAutosaveConflict) {
    return {
      ...common,
      candidateContentSha256: expectedCandidateSha256,
      editRevision: conflict.editRevision,
    };
  }
  const currentSource = await readSourceFile(context.sourcePath);
  if (currentSource.sha256 !== conflict.externalSourceSha256) {
    throw new HttpError(
      409,
      "CONFLICT_EXTERNAL_HASH_MISMATCH",
      "The external source changed again after this AI conflict was recorded.",
      {
        expectedExternalSourceSha256: conflict.externalSourceSha256,
        actualExternalSourceSha256: currentSource.sha256,
      },
    );
  }
  return {
    ...common,
    transactionId: conflict.transactionId,
    requestId: conflict.requestId,
    attemptId: conflict.attemptId,
    candidateVersionId: conflict.candidateVersionId,
    candidateOutputSha256: expectedCandidateSha256,
  };
}

async function projectFileGet(sourcePath) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(sourcePath);
  if (projectFileWorkspace) {
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
  const context = await loadContextBySource(sourcePath, false);
  const filePath = path.join(context.projectRoot, "PROJECT.md");
  const buffer = await readFile(filePath);
  const information = await stat(filePath);
  return {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
    content: buffer.toString("utf8"),
    sha256: sha256(buffer),
    updatedAt: information.mtime.toISOString(),
    path: filePath,
    relativePath: `projects/${context.storageDirectoryName}/PROJECT.md`,
  };
}

async function projectFileUpdate(body) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (projectFileWorkspace) {
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
  const context = await loadMutationContext(body);
  assertBodyContext(context, body);
  if (typeof body.content !== "string" || !body.content.trim()) {
    throw new HttpError(
      400,
      "INVALID_PROJECT_FILE",
      "content must be non-empty Markdown.",
    );
  }
  return withProjectMutation(context, async () => {
    await recoverPendingWriteRaw(context);
    const runtime = await readRuntime(context);
    assertProjectMutable(runtime);
    const filePath = path.join(context.projectRoot, "PROJECT.md");
    const previous = await readFile(filePath);
    const buffer = Buffer.from(body.content, "utf8");
    const updated = !previous.equals(buffer);
    if (updated) await atomicWriteFile(filePath, buffer);
    return {
      ok: true,
      updated,
      projectId: context.projectId,
      documentId: context.documentId,
      content: body.content,
      sha256: sha256(buffer),
      path: filePath,
      relativePath: `projects/${context.storageDirectoryName}/PROJECT.md`,
    };
  });
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
        { projectStorageVersion: url.searchParams.get("projectStorageVersion") },
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
        { projectStorageVersion: url.searchParams.get("projectStorageVersion") },
      ),
    );
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
    const projectFileWorkspace = await projectFileWorkspaceForSource(body.sourcePath);
    const projectRoot = projectFileWorkspace
      ? projectFileWorkspace.target.projectRootPath
      : (await loadContextBySource(body.sourcePath, false)).projectRoot;
    if (process.platform !== "darwin") {
      throw new HttpError(
        501,
        "PLATFORM_NOT_SUPPORTED",
        "Opening Finder is only supported on macOS.",
      );
    }
    await execFileAsync("open", [projectRoot]);
    sendJson(response, 200, { ok: true, path: projectRoot });
    return;
  }
  throw new HttpError(404, "NOT_FOUND", "Endpoint was not found.");
}

await initializeRoot();

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
