import {
  constants as fsConstants,
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../lifecycle-core.mjs";

export const MAX_HTML_BYTES = 20 * 1024 * 1024;
export const MAX_PROMPT_BYTES = 256 * 1024;
export const MAX_COMMENT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const POLICY_ERROR_NAME = "AgentPolicyError";
export const AGENT_POLICY_BRAND = Symbol("pageroot-agent-policy");

const FINALIZER_PATH = fileURLToPath(
  new URL("../../finalize-attempt.mjs", import.meta.url),
);
const EXPECTED_READ_ORDER = Object.freeze([
  "PROMPT.md",
  "input/AI_RULES.md",
  "change-request.json",
  "input/PROJECT.md",
  "input/base/index.html",
  "input/annotations/records.json",
]);
const EXPECTED_READ_ROLES = Object.freeze(new Map([
  ["PROMPT.md", "prompt"],
  ["input/AI_RULES.md", "policy"],
  ["change-request.json", "change-request"],
  ["input/PROJECT.md", "project-rules"],
  ["input/base/index.html", "base-html"],
  ["input/annotations/records.json", "annotations"],
]));
const EXPECTED_MEDIA_TYPES = Object.freeze(new Map([
  ["PROMPT.md", "text/markdown"],
  ["input/AI_RULES.md", "text/markdown"],
  ["change-request.json", "application/json"],
  ["input/PROJECT.md", "text/markdown"],
  ["input/base/index.html", "text/html"],
  ["input/annotations/records.json", "application/json"],
]));
const COMMENT_ATTACHMENT_READ_PATH =
  /^input\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+$/u;
const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u;
const SAFE_TASK_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export function policyError(suffix, message, details = {}) {
  const error = new Error(message);
  error.name = POLICY_ERROR_NAME;
  error.code = suffix.startsWith("AGENT_")
    ? suffix
    : `AGENT_${suffix}`;
  error.details = details;
  return error;
}

export function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

export function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export function assertAbsolutePath(value, label) {
  const candidate = assertNonEmptyString(value, label);
  if (!path.isAbsolute(candidate)) {
    throw new TypeError(`${label} must be an absolute path.`);
  }
  return path.resolve(candidate);
}

function inside(root, candidate, { allowRoot = false } = {}) {
  const relative = path.relative(root, candidate);
  return (allowRoot && relative === "")
    || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertNoSymlinkAncestors(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw policyError("PATH_OUTSIDE_REQUEST", `${label} escapes the Request root.`);
  }
  const parts = relative ? relative.split(path.sep) : [];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const information = await lstat(current);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw policyError(
        "UNSAFE_ANCESTOR",
        `${label} has a non-directory or symlink ancestor.`,
      );
    }
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size;
}

export async function readVerifiedRegularFile(filePath, root, label) {
  const resolved = path.resolve(filePath);
  if (!inside(root, resolved)) {
    throw policyError("PATH_OUTSIDE_REQUEST", `${label} escapes the Request root.`);
  }
  await assertNoSymlinkAncestors(root, resolved, label);
  const information = await lstat(resolved);
  if (information.isSymbolicLink() || !information.isFile()) {
    throw policyError("UNSAFE_FILE", `${label} must be a regular, non-symlink file.`);
  }
  const canonical = await realpath(resolved);
  if (!inside(root, canonical)) {
    throw policyError("REALPATH_OUTSIDE_REQUEST", `${label} resolves outside the Request root.`);
  }
  const handle = await open(
    resolved,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || !sameFileIdentity(before, information)) {
      throw policyError("FILE_CHANGED", `${label} changed while it was being opened.`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after) || bytes.byteLength !== after.size) {
      throw policyError("FILE_CHANGED", `${label} changed while it was being read.`);
    }
    return { path: resolved, canonical, information: after, bytes };
  } finally {
    await handle.close();
  }
}

export async function verifiedOutputParent(outputPath, root) {
  const parentPath = path.dirname(outputPath);
  if (!inside(root, outputPath) || !inside(root, parentPath, { allowRoot: true })) {
    throw policyError(
      "OUTPUT_OUTSIDE_REQUEST",
      "The Candidate output path escapes the Request root.",
    );
  }
  await assertNoSymlinkAncestors(root, outputPath, "Candidate output");
  const information = await lstat(parentPath);
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw policyError(
      "UNSAFE_OUTPUT_DIRECTORY",
      "The Candidate output directory must be a real directory.",
    );
  }
  const canonical = await realpath(parentPath);
  if (!inside(root, canonical, { allowRoot: true })) {
    throw policyError(
      "OUTPUT_REALPATH_OUTSIDE_REQUEST",
      "The Candidate output directory resolves outside the Request root.",
    );
  }
}

async function canonicalFuturePath(value, label) {
  const requested = assertAbsolutePath(value, label);
  const canonicalParent = await realpath(path.dirname(requested));
  return path.join(canonicalParent, path.basename(requested));
}

function expectedManifestFile(manifest, relativePath) {
  const matches = manifest.files.filter((entry) => entry?.path === relativePath);
  if (matches.length !== 1) {
    throw policyError(
      "MANIFEST_ENTRY_INVALID",
      `The frozen read path ${JSON.stringify(relativePath)} has no unique manifest entry.`,
    );
  }
  return matches[0];
}

async function verifyFrozenEntry(requestRoot, manifest, relativePath) {
  if (
    typeof relativePath !== "string"
    || !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")
  ) {
    throw policyError(
      "MANIFEST_PATH_INVALID",
      "The frozen input manifest contains an unsafe read path.",
    );
  }
  const entry = assertObject(expectedManifestFile(manifest, relativePath), "manifest file entry");
  const file = await readVerifiedRegularFile(
    path.join(requestRoot, ...relativePath.split("/")),
    requestRoot,
    `Frozen input ${relativePath}`,
  );
  const { bytes } = file;
  if (entry.byteLength !== bytes.byteLength || entry.sha256 !== sha256(bytes)) {
    throw policyError(
      "FROZEN_INPUT_DRIFT",
      `Frozen input ${JSON.stringify(relativePath)} no longer matches its manifest.`,
    );
  }
  return Object.freeze({
    path: file.path,
    relativePath,
    role: String(entry.role || "unknown"),
    byteLength: bytes.byteLength,
    sha256: entry.sha256,
  });
}

export function projectRootForRequest(requestRoot, requestId) {
  const requestsRoot = path.dirname(requestRoot);
  const controlRoot = path.dirname(requestsRoot);
  if (
    path.basename(requestRoot) !== requestId
    || path.basename(requestsRoot) !== "requests"
    || path.basename(controlRoot) !== ".pageroot"
  ) {
    throw policyError(
      "REQUEST_LAYOUT_INVALID",
      "The Request root is not the current PageRoot .pageroot/requests layout.",
    );
  }
  return path.dirname(controlRoot);
}

async function officialFinalizer({ requestRoot, requestId, attemptId }) {
  const projectRoot = projectRootForRequest(requestRoot, requestId);
  const expectedCommand = await realpath(process.execPath);
  const expectedFinalizerPath = await realpath(FINALIZER_PATH);
  return Object.freeze({
    command: expectedCommand,
    args: Object.freeze([
      expectedFinalizerPath,
      "--project-root",
      projectRoot,
      "--request-id",
      requestId,
      "--attempt-id",
      attemptId,
    ]),
    env: Object.freeze(process.versions.electron
      ? { ELECTRON_RUN_AS_NODE: "1" }
      : {}),
    cwd: requestRoot,
  });
}

async function verifiedJsonFile(filePath, root, label) {
  const file = await readVerifiedRegularFile(filePath, root, label);
  try {
    return {
      file,
      value: assertObject(JSON.parse(file.bytes.toString("utf8")), label),
    };
  } catch (cause) {
    if (cause?.name === POLICY_ERROR_NAME) throw cause;
    throw policyError("AUTHORITY_INVALID", `${label} is not valid JSON.`);
  }
}

export async function assertRuntimeProcessingAuthority(policy) {
  const runtimeAuthority = await verifiedJsonFile(
    policy.runtimePath,
    policy.controlRoot,
    "Runtime authority",
  );
  const runtime = runtimeAuthority.value;
  const activeRequest = runtime.activeRequest;
  if (
    runtime.schemaVersion !== "4.0.0"
    || runtime.projectId !== policy.projectId
    || runtime.documentId !== policy.documentId
    || runtime.activeCandidateId !== null
    || !activeRequest
    || activeRequest.requestId !== policy.requestId
    || activeRequest.attemptId !== policy.attemptId
    || activeRequest.status !== "processing"
    || activeRequest.candidateId !== null
    || activeRequest.inputManifestSha256 !== policy.inputManifestSha256
    || activeRequest.candidateOutputSha256 !== null
    || activeRequest.candidateRecordSha256 !== null
  ) {
    throw policyError(
      "RUNTIME_AUTHORITY_DRIFT",
      "PageRoot no longer authorizes mutations for this Agent Attempt.",
    );
  }
}

async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function loadExecutionPolicy(options) {
  const value = assertObject(options, "Agent execution policy options");
  const allowedOptionNames = new Set([
    "requestPath",
    "promptPath",
    "outputPath",
    "completionPath",
  ]);
  const unexpectedOption = Object.keys(value).find((name) => !allowedOptionNames.has(name));
  if (unexpectedOption) {
    throw policyError(
      "POLICY_OPTIONS_INVALID",
      `Agent execution policy options contain unsupported field ${JSON.stringify(unexpectedOption)}.`,
    );
  }
  const { requestPath, promptPath, outputPath, completionPath } = value;
  const requestedRoot = assertAbsolutePath(requestPath, "requestPath");
  const requestInformation = await lstat(requestedRoot);
  if (requestInformation.isSymbolicLink() || !requestInformation.isDirectory()) {
    throw policyError("UNSAFE_REQUEST_ROOT", "The Request root must be a real directory.");
  }
  const requestRoot = await realpath(requestedRoot);
  const requestId = path.basename(requestRoot);
  if (!SAFE_TASK_ID.test(requestId)) {
    throw policyError("REQUEST_ID_INVALID", "The Request root has an invalid Request identity.");
  }
  const projectRoot = projectRootForRequest(requestRoot, requestId);
  const controlRoot = path.join(projectRoot, ".pageroot");
  const requestAuthority = await verifiedJsonFile(
    path.join(requestRoot, "request.json"),
    requestRoot,
    "Request authority",
  );
  const requestRecord = requestAuthority.value;
  const attemptId = String(requestRecord.attemptId || "");
  const projectId = String(requestRecord.projectId || "");
  const documentId = String(requestRecord.documentId || "");
  const inputManifestSha256 = String(requestRecord.inputManifestSha256 || "");
  const expectedOutputRelativePath = `requests/${requestId}/attempts/${attemptId}/output/candidate.html`;
  if (
    requestRecord.schemaVersion !== "4.0.0"
    || requestRecord.requestId !== requestId
    || !SAFE_TASK_ID.test(attemptId)
    || !PROJECT_ID.test(projectId)
    || !DOCUMENT_ID.test(documentId)
    || !SHA256.test(inputManifestSha256)
    || requestRecord.status !== "processing"
    || requestRecord.inputManifestRelativePath !== `requests/${requestId}/input-manifest.json`
    || requestRecord.promptRelativePath !== `requests/${requestId}/PROMPT.md`
    || requestRecord.outputRelativePath !== expectedOutputRelativePath
  ) {
    throw policyError(
      "REQUEST_AUTHORITY_MISMATCH",
      "request.json does not describe one current frozen PageRoot Attempt.",
    );
  }
  const runtimeAuthority = await verifiedJsonFile(
    path.join(controlRoot, "runtime-state.json"),
    controlRoot,
    "Runtime authority",
  );
  const runtime = runtimeAuthority.value;
  const activeRequest = runtime.activeRequest;
  if (
    runtime.schemaVersion !== "4.0.0"
    || runtime.projectId !== projectId
    || runtime.documentId !== documentId
    || runtime.activeCandidateId !== null
    || !activeRequest
    || activeRequest.requestId !== requestId
    || activeRequest.attemptId !== attemptId
    || activeRequest.status !== "processing"
    || activeRequest.candidateId !== null
    || activeRequest.inputManifestSha256 !== inputManifestSha256
    || activeRequest.candidateOutputSha256 !== null
    || activeRequest.candidateRecordSha256 !== null
  ) {
    throw policyError(
      "RUNTIME_AUTHORITY_MISMATCH",
      "The external runtime authority does not seal this active PageRoot Attempt.",
    );
  }
  const manifestPath = path.join(requestRoot, "input-manifest.json");
  const manifestFile = await readVerifiedRegularFile(
    manifestPath,
    requestRoot,
    "Frozen input manifest",
  );
  const manifestBytes = manifestFile.bytes;
  if (inputManifestSha256 !== sha256(manifestBytes)) {
    throw policyError(
      "INPUT_MANIFEST_HASH_MISMATCH",
      "The frozen input manifest does not match PageRoot's external runtime authority.",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw policyError(
      "INPUT_MANIFEST_INVALID",
      "The frozen input manifest is not valid JSON.",
    );
  }
  assertObject(manifest, "input manifest");
  if (manifest.frozen !== true || !Array.isArray(manifest.readOrder) || !Array.isArray(manifest.files)) {
    throw policyError(
      "INPUT_MANIFEST_INVALID",
      "The input manifest does not describe a frozen ordered input set.",
    );
  }
  const assertIdentity = (actual, expected, label) => {
    if (actual !== expected) {
      throw policyError(
        "TASK_IDENTITY_MISMATCH",
        `${label} does not match the PageRoot task identity.`,
      );
    }
  };
  assertIdentity(manifest.projectId, projectId, "projectId");
  assertIdentity(manifest.documentId, documentId, "documentId");
  assertIdentity(manifest.requestId, requestId, "requestId");
  assertIdentity(manifest.attemptId, attemptId, "attemptId");
  if (
    manifest.readOrder.length < EXPECTED_READ_ORDER.length
    || manifest.readOrder.some((entry, index) => (
      index < EXPECTED_READ_ORDER.length
        ? entry !== EXPECTED_READ_ORDER[index]
        : false
    ))
    || manifest.files.length !== manifest.readOrder.length
  ) {
    throw policyError(
      "INPUT_MANIFEST_SHAPE_MISMATCH",
      "The Agent execution policy only accepts PageRoot's exact current frozen input manifest shape.",
    );
  }

  const readableFiles = new Map();
  readableFiles.set(manifestFile.path, Object.freeze({
    path: manifestFile.path,
    relativePath: "input-manifest.json",
    role: "manifest",
    byteLength: manifestBytes.byteLength,
    sha256: sha256(manifestBytes),
  }));
  for (const relativePath of manifest.readOrder) {
    const entry = await verifyFrozenEntry(requestRoot, manifest, relativePath);
    const manifestEntry = expectedManifestFile(manifest, relativePath);
    const isBaseInput = EXPECTED_READ_ROLES.has(relativePath);
    const validCommentAttachment = (
      COMMENT_ATTACHMENT_READ_PATH.test(relativePath)
      && manifestEntry.role === "comment-attachment"
      && MEDIA_TYPE.test(String(manifestEntry.mediaType || ""))
      && Number.isSafeInteger(manifestEntry.byteLength)
      && manifestEntry.byteLength > 0
      && manifestEntry.byteLength <= MAX_COMMENT_ATTACHMENT_BYTES
    );
    if (
      isBaseInput
        ? (
          entry.role !== EXPECTED_READ_ROLES.get(relativePath)
          || manifestEntry.mediaType !== EXPECTED_MEDIA_TYPES.get(relativePath)
        )
        : !validCommentAttachment
    ) {
      throw policyError(
        "MANIFEST_ENTRY_INVALID",
        `Frozen input ${JSON.stringify(relativePath)} has an unexpected role or media type.`,
      );
    }
    if (readableFiles.has(entry.path)) {
      throw policyError("READ_ORDER_DUPLICATE", "The input read order contains duplicates.");
    }
    readableFiles.set(entry.path, entry);
  }

  const requestedPromptPath = assertAbsolutePath(promptPath, "promptPath");
  const normalizedPromptPath = await realpath(requestedPromptPath).catch(() => requestedPromptPath);
  const expectedPromptPath = path.join(requestRoot, "PROMPT.md");
  const promptEntry = readableFiles.get(normalizedPromptPath);
  if (
    normalizedPromptPath !== expectedPromptPath
    || !promptEntry
    || promptEntry.role !== "prompt"
  ) {
    throw policyError(
      "PROMPT_NOT_AUTHORIZED",
      "PROMPT.md is not the manifest-authorized prompt for this Request.",
      {
        expectedPromptPath,
        normalizedPromptPath,
        manifestRole: promptEntry?.role ?? null,
        authorized: Boolean(promptEntry),
      },
    );
  }

  const normalizedOutputPath = await canonicalFuturePath(outputPath, "outputPath");
  await verifiedOutputParent(normalizedOutputPath, requestRoot);
  const expectedOutputPath = path.join(
    requestRoot,
    "attempts",
    attemptId,
    "output",
    "candidate.html",
  );
  if (normalizedOutputPath !== expectedOutputPath) {
    throw policyError(
      "OUTPUT_ATTEMPT_MISMATCH",
      "The Candidate output does not belong to the authorized Attempt.",
    );
  }
  if (await fileExists(normalizedOutputPath)) {
    throw policyError(
      "OUTPUT_PREEXISTS",
      "The Agent execution policy requires a fresh Attempt output path.",
    );
  }

  const normalizedCompletionPath = await canonicalFuturePath(completionPath, "completionPath");
  const expectedCompletionPath = path.join(
    requestRoot,
    "attempts",
    attemptId,
    "completion.json",
  );
  if (normalizedCompletionPath !== expectedCompletionPath) {
    throw policyError(
      "COMPLETION_OUTSIDE_REQUEST",
      "The completion path escapes the Request root.",
    );
  }
  if (await fileExists(normalizedCompletionPath)) {
    throw policyError(
      "COMPLETION_PREEXISTS",
      "The Agent execution policy requires a fresh Attempt completion path.",
    );
  }

  return Object.freeze({
    [AGENT_POLICY_BRAND]: true,
    mode: "execution",
    requestRoot,
    controlRoot,
    runtimePath: path.join(controlRoot, "runtime-state.json"),
    manifestPath: manifestFile.path,
    promptPath: normalizedPromptPath,
    outputPath: normalizedOutputPath,
    completionPath: normalizedCompletionPath,
    inputManifestSha256,
    projectId,
    documentId,
    requestId,
    attemptId,
    readableFiles: Object.freeze([...readableFiles.values()]),
    finalizer: await officialFinalizer({ requestRoot, requestId, attemptId }),
  });
}
