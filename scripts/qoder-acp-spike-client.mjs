import {
  access,
  constants as fsConstants,
  lstat,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

import { sha256 } from "./lifecycle-core.mjs";

const MAX_HTML_BYTES = 20 * 1024 * 1024;
const DEFAULT_TERMINAL_OUTPUT_BYTES = 1024 * 1024;
const MAX_TERMINAL_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const PROCESS_EXIT_GRACE_MS = 2_000;
const PROCESS_PROTOCOL_DRAIN_MS = 250;
const MAX_ACP_FRAME_BYTES = MAX_HTML_BYTES + (2 * 1024 * 1024);
const POLICY_BRAND = Symbol("pageroot-qoder-acp-policy");
const FINALIZER_PATH = fileURLToPath(new URL("./finalize-attempt.mjs", import.meta.url));
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
const SAFE_QODER_ENVIRONMENT_NAMES = Object.freeze(new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]));
const processClosePromises = new WeakMap();
const SAFE_TASK_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function policyError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "QoderAcpPolicyError";
  error.code = code;
  error.details = details;
  return error;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function assertAbsolutePath(value, label) {
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
    throw policyError("ACP_PATH_OUTSIDE_REQUEST", `${label} escapes the Request root.`);
  }
  const parts = relative ? relative.split(path.sep) : [];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const information = await lstat(current);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw policyError(
        "ACP_UNSAFE_ANCESTOR",
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

function assertIdentity(actual, expected, label) {
  if (actual !== expected) {
    throw policyError(
      "ACP_TASK_IDENTITY_MISMATCH",
      `${label} does not match the PageRoot task identity.`,
    );
  }
}

async function verifiedRegularFile(filePath, root, label) {
  const resolved = path.resolve(filePath);
  if (!inside(root, resolved)) {
    throw policyError("ACP_PATH_OUTSIDE_REQUEST", `${label} escapes the Request root.`);
  }
  await assertNoSymlinkAncestors(root, resolved, label);
  const information = await lstat(resolved);
  if (information.isSymbolicLink() || !information.isFile()) {
    throw policyError("ACP_UNSAFE_FILE", `${label} must be a regular, non-symlink file.`);
  }
  const canonical = await realpath(resolved);
  if (!inside(root, canonical)) {
    throw policyError("ACP_REALPATH_OUTSIDE_REQUEST", `${label} resolves outside the Request root.`);
  }
  return { path: resolved, canonical, information };
}

async function readVerifiedRegularFile(filePath, root, label) {
  const verified = await verifiedRegularFile(filePath, root, label);
  const handle = await open(
    verified.path,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || !sameFileIdentity(before, verified.information)) {
      throw policyError("ACP_FILE_CHANGED", `${label} changed while it was being opened.`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after) || bytes.byteLength !== after.size) {
      throw policyError("ACP_FILE_CHANGED", `${label} changed while it was being read.`);
    }
    return { ...verified, information: after, bytes };
  } finally {
    await handle.close();
  }
}

async function verifiedOutputParent(outputPath, root) {
  const parentPath = path.dirname(outputPath);
  if (!inside(root, outputPath) || !inside(root, parentPath, { allowRoot: true })) {
    throw policyError(
      "ACP_OUTPUT_OUTSIDE_REQUEST",
      "The Candidate output path escapes the Request root.",
    );
  }
  await assertNoSymlinkAncestors(root, outputPath, "Candidate output");
  const information = await lstat(parentPath);
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw policyError(
      "ACP_UNSAFE_OUTPUT_DIRECTORY",
      "The Candidate output directory must be a real directory.",
    );
  }
  const canonical = await realpath(parentPath);
  if (!inside(root, canonical, { allowRoot: true })) {
    throw policyError(
      "ACP_OUTPUT_REALPATH_OUTSIDE_REQUEST",
      "The Candidate output directory resolves outside the Request root.",
    );
  }
}

function expectedManifestFile(manifest, relativePath) {
  const matches = manifest.files.filter((entry) => entry?.path === relativePath);
  if (matches.length !== 1) {
    throw policyError(
      "ACP_MANIFEST_ENTRY_INVALID",
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
      "ACP_MANIFEST_PATH_INVALID",
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
  if (
    entry.byteLength !== bytes.byteLength
    || entry.sha256 !== sha256(bytes)
  ) {
    throw policyError(
      "ACP_FROZEN_INPUT_DRIFT",
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

function projectRootForRequest(requestRoot, requestId) {
  const requestsRoot = path.dirname(requestRoot);
  const controlRoot = path.dirname(requestsRoot);
  if (
    path.basename(requestRoot) !== requestId
    || path.basename(requestsRoot) !== "requests"
    || path.basename(controlRoot) !== ".pageroot"
  ) {
    throw policyError(
      "ACP_REQUEST_LAYOUT_INVALID",
      "The Request root is not the current PageRoot .pageroot/requests layout.",
    );
  }
  return path.dirname(controlRoot);
}

async function officialFinalizer({ requestRoot, requestId, attemptId }) {
  const projectRoot = projectRootForRequest(requestRoot, requestId);
  const expectedCommand = await realpath(process.execPath);
  const expectedFinalizerPath = await realpath(FINALIZER_PATH);
  const expectedArgs = [
    expectedFinalizerPath,
    "--project-root",
    projectRoot,
    "--request-id",
    requestId,
    "--attempt-id",
    attemptId,
  ];
  return Object.freeze({
    command: expectedCommand,
    args: Object.freeze(expectedArgs),
    env: Object.freeze({}),
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
    if (cause?.name === "QoderAcpPolicyError") throw cause;
    throw policyError("ACP_AUTHORITY_INVALID", `${label} is not valid JSON.`);
  }
}

export async function loadQoderAcpTaskPolicy(options) {
  const value = assertObject(options, "ACP task policy options");
  const allowedOptionNames = new Set([
    "requestPath",
    "promptPath",
    "outputPath",
    "completionPath",
  ]);
  const unexpectedOption = Object.keys(value).find((name) => !allowedOptionNames.has(name));
  if (unexpectedOption) {
    throw policyError(
      "ACP_POLICY_OPTIONS_INVALID",
      `ACP task policy options contain unsupported field ${JSON.stringify(unexpectedOption)}.`,
    );
  }
  const {
    requestPath,
    promptPath,
    outputPath,
    completionPath,
  } = value;
  const requestedRoot = assertAbsolutePath(requestPath, "requestPath");
  const requestInformation = await lstat(requestedRoot);
  if (requestInformation.isSymbolicLink() || !requestInformation.isDirectory()) {
    throw policyError("ACP_UNSAFE_REQUEST_ROOT", "The Request root must be a real directory.");
  }
  const requestRoot = await realpath(requestedRoot);
  const requestId = path.basename(requestRoot);
  if (!SAFE_TASK_ID.test(requestId)) {
    throw policyError("ACP_REQUEST_ID_INVALID", "The Request root has an invalid Request identity.");
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
      "ACP_REQUEST_AUTHORITY_MISMATCH",
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
      "ACP_RUNTIME_AUTHORITY_MISMATCH",
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
  if (
    typeof inputManifestSha256 !== "string"
    || inputManifestSha256 !== sha256(manifestBytes)
  ) {
    throw policyError(
      "ACP_INPUT_MANIFEST_HASH_MISMATCH",
      "The frozen input manifest does not match PageRoot's external runtime authority.",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw policyError(
      "ACP_INPUT_MANIFEST_INVALID",
      "The frozen input manifest is not valid JSON.",
    );
  }
  assertObject(manifest, "input manifest");
  if (manifest.frozen !== true || !Array.isArray(manifest.readOrder) || !Array.isArray(manifest.files)) {
    throw policyError(
      "ACP_INPUT_MANIFEST_INVALID",
      "The input manifest does not describe a frozen ordered input set.",
    );
  }
  assertIdentity(manifest.projectId, projectId, "projectId");
  assertIdentity(manifest.documentId, documentId, "documentId");
  assertIdentity(manifest.requestId, requestId, "requestId");
  assertIdentity(manifest.attemptId, attemptId, "attemptId");
  if (
    manifest.readOrder.length !== EXPECTED_READ_ORDER.length
    || manifest.readOrder.some((value, index) => value !== EXPECTED_READ_ORDER[index])
    || manifest.files.length !== EXPECTED_READ_ORDER.length
  ) {
    throw policyError(
      "ACP_INPUT_MANIFEST_SHAPE_MISMATCH",
      "The ACP spike only accepts PageRoot's exact current frozen input manifest shape.",
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
    if (
      entry.role !== EXPECTED_READ_ROLES.get(relativePath)
      || expectedManifestFile(manifest, relativePath).mediaType
        !== EXPECTED_MEDIA_TYPES.get(relativePath)
    ) {
      throw policyError(
        "ACP_MANIFEST_ENTRY_INVALID",
        `Frozen input ${JSON.stringify(relativePath)} has an unexpected role or media type.`,
      );
    }
    if (readableFiles.has(entry.path)) {
      throw policyError("ACP_READ_ORDER_DUPLICATE", "The input read order contains duplicates.");
    }
    readableFiles.set(entry.path, entry);
  }

  const normalizedPromptPath = assertAbsolutePath(promptPath, "promptPath");
  const expectedPromptPath = path.join(requestRoot, "PROMPT.md");
  const promptEntry = readableFiles.get(normalizedPromptPath);
  if (
    normalizedPromptPath !== expectedPromptPath
    || !promptEntry
    || promptEntry.role !== "prompt"
  ) {
    throw policyError(
      "ACP_PROMPT_NOT_AUTHORIZED",
      "PROMPT.md is not the manifest-authorized prompt for this Request.",
      {
        expectedPromptPath,
        normalizedPromptPath,
        manifestRole: promptEntry?.role ?? null,
        authorized: Boolean(promptEntry),
      },
    );
  }

  const normalizedOutputPath = assertAbsolutePath(outputPath, "outputPath");
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
      "ACP_OUTPUT_ATTEMPT_MISMATCH",
      "The Candidate output does not belong to the authorized Attempt.",
    );
  }
  if (await fileExists(normalizedOutputPath)) {
    throw policyError(
      "ACP_OUTPUT_PREEXISTS",
      "The ACP spike requires a fresh Attempt output path.",
    );
  }

  const normalizedCompletionPath = assertAbsolutePath(completionPath, "completionPath");
  const expectedCompletionPath = path.join(
    requestRoot,
    "attempts",
    attemptId,
    "completion.json",
  );
  if (normalizedCompletionPath !== expectedCompletionPath) {
    throw policyError(
      "ACP_COMPLETION_OUTSIDE_REQUEST",
      "The completion path escapes the Request root.",
    );
  }
  if (await fileExists(normalizedCompletionPath)) {
    throw policyError(
      "ACP_COMPLETION_PREEXISTS",
      "The ACP spike requires a fresh Attempt completion path.",
    );
  }

  const normalizedFinalizer = await officialFinalizer({
    requestRoot,
    requestId,
    attemptId,
  });

  return Object.freeze({
    [POLICY_BRAND]: true,
    requestRoot,
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
    finalizer: normalizedFinalizer,
  });
}

function validateSession(boundSessionId, receivedSessionId) {
  if (!boundSessionId || receivedSessionId !== boundSessionId) {
    throw policyError(
      "ACP_SESSION_ID_MISMATCH",
      "The ACP operation does not belong to the active PageRoot task session.",
    );
  }
}

function slicedLines(content, line, limit) {
  if (line == null && limit == null) return content;
  const start = line == null ? 0 : line - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000) {
    throw policyError("ACP_READ_RANGE_INVALID", "ACP line must be a positive integer.");
  }
  if (
    limit != null
    && (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100_000)
  ) {
    throw policyError("ACP_READ_RANGE_INVALID", "ACP limit must be a positive integer.");
  }
  const lines = content.match(/[^\n]*(?:\n|$)/gu) || [];
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(start, limit == null ? undefined : start + limit).join("");
}

function terminalOutputLimit(value) {
  if (value == null) return DEFAULT_TERMINAL_OUTPUT_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TERMINAL_OUTPUT_BYTES) {
    throw policyError(
      "ACP_TERMINAL_OUTPUT_LIMIT_INVALID",
      "The terminal output byte limit is outside PageRoot's supported range.",
    );
  }
  return value;
}

function truncateUtf8Tail(value, byteLimit) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= byteLimit) return { value, truncated: false };
  let start = bytes.byteLength - byteLimit;
  while (start < bytes.byteLength && (bytes[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return {
    value: bytes.subarray(start).toString("utf8"),
    truncated: true,
  };
}

class AcpFrameGuard extends Transform {
  #decoder = new TextDecoder("utf-8", { fatal: true });

  #frameBytes = 0;

  _transform(chunk, _encoding, callback) {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.#decoder.decode(bytes, { stream: true });
      let offset = 0;
      for (;;) {
        const newline = bytes.indexOf(0x0a, offset);
        if (newline === -1) {
          this.#frameBytes += bytes.byteLength - offset;
          break;
        }
        this.#frameBytes += newline - offset;
        if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
          throw policyError("ACP_FRAME_TOO_LARGE", "Qoder emitted an oversized ACP frame.");
        }
        this.#frameBytes = 0;
        offset = newline + 1;
      }
      if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
        throw policyError("ACP_FRAME_TOO_LARGE", "Qoder emitted an oversized ACP frame.");
      }
      callback(null, bytes);
    } catch (error) {
      callback(String(error?.code || "").startsWith("ACP_")
        ? error
        : policyError("ACP_UTF8_INVALID", "Qoder emitted invalid UTF-8 over ACP."));
    }
  }

  _flush(callback) {
    try {
      this.#decoder.decode();
      callback();
    } catch {
      callback(policyError("ACP_UTF8_INVALID", "Qoder emitted invalid UTF-8 over ACP."));
    }
  }
}

function qoderEnvironment(overrides = {}) {
  assertObject(overrides, "Qoder environment");
  const result = {};
  for (const name of SAFE_QODER_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") result[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!SAFE_QODER_ENVIRONMENT_NAMES.has(name) || typeof value !== "string") {
      throw new TypeError(`Qoder environment override ${JSON.stringify(name)} is not allowed.`);
    }
    result[name] = value;
  }
  return result;
}

function envArrayMatches(requested, expected) {
  if (!Array.isArray(requested)) return false;
  const entries = Object.entries(expected);
  if (requested.length !== entries.length) return false;
  const received = new Map();
  for (const entry of requested) {
    if (
      !entry
      || typeof entry !== "object"
      || typeof entry.name !== "string"
      || typeof entry.value !== "string"
      || received.has(entry.name)
    ) return false;
    received.set(entry.name, entry.value);
  }
  return entries.every(([name, value]) => received.get(name) === value);
}

function finalizerRequestMatches(params, finalizer) {
  const args = Array.isArray(params.args) ? params.args : [];
  const cwdMatches = typeof params.cwd === "string"
    && path.isAbsolute(params.cwd)
    && path.resolve(params.cwd) === finalizer.cwd;
  if (!cwdMatches || !envArrayMatches(params.env, finalizer.env)) return false;
  return (
    typeof params.command === "string"
    && path.isAbsolute(params.command)
    && path.resolve(params.command) === finalizer.command
    && args.length === finalizer.args.length
    && args.every((argument, index) => argument === finalizer.args[index])
  );
}

function terminalExitStatus(child) {
  if (child.exitCode === null && child.signalCode === null) return null;
  return {
    exitCode: child.exitCode,
    signal: child.signalCode,
  };
}

async function waitForExit(child) {
  const existing = processClosePromises.get(child);
  if (existing) return existing;
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const handleClose = () => {
      cleanup();
      resolve(terminalExitStatus(child));
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("close", handleClose);
    child.once("error", handleError);
  });
  processClosePromises.set(child, promise);
  return promise;
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

export async function captureQoderAcpReviewBoundary({
  repository,
  target,
  projectRoot,
}) {
  if (typeof repository?.workspace !== "function") {
    throw new TypeError("A ProjectFileRepository-compatible workspace reader is required.");
  }
  const verifiedTarget = assertObject(target, "Working Copy target");
  const verifiedProjectRoot = await realpath(
    assertAbsolutePath(projectRoot, "projectRoot"),
  );
  const targetProjectRoot = await realpath(
    assertAbsolutePath(verifiedTarget.projectRootPath, "target.projectRootPath"),
  );
  if (verifiedProjectRoot !== targetProjectRoot) {
    throw policyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence root does not match the target Project File.",
    );
  }
  const workspace = await repository.workspace({
    sourcePath: assertAbsolutePath(verifiedTarget.exactSourcePath, "target.exactSourcePath"),
  });
  if (!workspace) {
    throw policyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence workspace could not be loaded.",
    );
  }
  const controlRoot = path.join(verifiedProjectRoot, ".pageroot");
  const manifestFile = await readVerifiedRegularFile(
    path.join(controlRoot, "manifest.json"),
    verifiedProjectRoot,
    "Project manifest evidence",
  );
  const versionSnapshots = [];
  for (const version of workspace.manifest.versions) {
    const snapshot = await readVerifiedRegularFile(
      path.join(controlRoot, version.snapshotRelativePath),
      verifiedProjectRoot,
      "Version snapshot evidence",
    );
    versionSnapshots.push({
      versionId: version.versionId,
      contentSha256: sha256(snapshot.bytes),
    });
  }
  return {
    target: {
      projectId: workspace.target.projectId,
      documentId: workspace.target.documentId,
      workingCopyId: workspace.target.workingCopyId,
      versionId: workspace.target.versionId,
      targetKind: workspace.target.targetKind,
      exactSourcePath: workspace.target.exactSourcePath,
      sourceSha256: workspace.target.sourceSha256,
    },
    manifest: workspace.manifest,
    manifestFileSha256: sha256(manifestFile.bytes),
    workingCopy: workspace.workingCopy,
    workingCopyState: workspace.workingCopyState,
    workingCopies: workspace.workingCopies,
    draft: workspace.draft,
    contentSha256: sha256(Buffer.from(workspace.content, "utf8")),
    versionSnapshots,
  };
}

export function createRestrictedQoderAcpHost(policy, {
  spawnProcess = spawn,
  renameOutput = rename,
  onEvent = () => {},
} = {}) {
  assertObject(policy, "policy");
  if (policy[POLICY_BRAND] !== true || !Array.isArray(policy.readableFiles)) {
    throw new TypeError("Restricted ACP host requires a verified PageRoot task policy.");
  }
  if (
    typeof spawnProcess !== "function"
    || typeof renameOutput !== "function"
    || typeof onEvent !== "function"
  ) {
    throw new TypeError("Restricted ACP host dependencies are invalid.");
  }
  let sessionId = null;
  let finalizerStarted = false;
  let finalizerOutcome = null;
  let finalizedOutputSha256 = null;
  let outputWritten = false;
  let phase = "active";
  let cancellationRequested = false;
  let cancellationPromise = null;
  let mutationTail = Promise.resolve();
  const terminals = new Map();
  const inFlight = new Set();
  const readableFiles = new Map(
    policy.readableFiles.map((entry) => [entry.path, entry]),
  );

  const event = (kind, details = {}) => onEvent(Object.freeze({ kind, ...details }));
  const assertActive = (signal) => {
    if (signal?.aborted) {
      throw policyError("ACP_REQUEST_CANCELLED", "The ACP request was cancelled.");
    }
    if (cancellationRequested || phase === "cancelling") {
      throw policyError("ACP_HOST_CANCELLING", "The ACP task host is cancelling.");
    }
    if (phase === "finalized") {
      throw policyError("ACP_HOST_FINALIZED", "The ACP task host already finalized its Candidate.");
    }
    if (phase === "disposed") {
      throw policyError("ACP_HOST_DISPOSED", "The ACP task host is already closed.");
    }
  };
  const trackActive = async (signal, operation) => {
    const promise = (async () => {
      assertActive(signal);
      return operation(() => assertActive(signal));
    })();
    inFlight.add(promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(promise);
    }
  };
  const acquireMutationLock = async () => {
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const previous = mutationTail;
    mutationTail = previous.then(
      () => current,
      () => current,
    );
    await previous.catch(() => {});
    return release;
  };
  const mutate = async (signal, operation) => {
    const release = await acquireMutationLock();
    try {
      assertActive(signal);
      return await operation(() => assertActive(signal));
    } finally {
      release();
    }
  };
  const terminal = (receivedSessionId, terminalId, signal) => {
    assertActive(signal);
    validateSession(sessionId, receivedSessionId);
    const record = terminals.get(terminalId);
    if (!record) {
      throw policyError("ACP_TERMINAL_UNKNOWN", "The ACP terminal is not owned by this task.");
    }
    return record;
  };
  const stopTerminals = async () => {
    const releases = [...terminals.values()].map(async (record) => {
      await terminateProcess(record.child, { processGroup: record.processGroup });
      await record.exitPromise.catch(() => {});
    });
    await Promise.all(releases);
    terminals.clear();
  };

  const host = {
    bindSessionId(nextSessionId) {
      assertActive();
      if (
        sessionId
        || typeof nextSessionId !== "string"
        || !/^[^\u0000-\u001f\u007f]{1,256}$/u.test(nextSessionId)
      ) {
        throw policyError("ACP_SESSION_BIND_INVALID", "The ACP session could not be bound.");
      }
      sessionId = nextSessionId;
      event("session-bound");
    },
    async requestPermission(params, signal) {
      validateSession(sessionId, params.sessionId);
      if (signal?.aborted || cancellationRequested || phase !== "active") {
        return { outcome: { outcome: "cancelled" } };
      }
      const options = Array.isArray(params.options) ? params.options : [];
      const optionIds = new Set();
      const validOptions = options.every((option) => (
        option
        && typeof option.optionId === "string"
        && option.optionId.length > 0
        && option.optionId.length <= 256
        && !optionIds.has(option.optionId)
        && Boolean(optionIds.add(option.optionId))
      ));
      const allowOnce = validOptions
        ? options.find((option) => option.kind === "allow_once")
        : null;
      if (!allowOnce) {
        event("permission-rejected", { toolKind: params.toolCall?.kind || "unknown" });
        return { outcome: { outcome: "cancelled" } };
      }
      event("permission-allowed-once", { toolKind: params.toolCall?.kind || "unknown" });
      return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
    },
    async readTextFile(params, signal) {
      return trackActive(signal, async (checkActive) => {
        validateSession(sessionId, params.sessionId);
        const requestedPath = assertAbsolutePath(params.path, "fs/read_text_file path");
        const authorized = readableFiles.get(requestedPath);
        if (!authorized) {
          throw policyError(
            "ACP_READ_NOT_AUTHORIZED",
            "Qoder requested a file outside the frozen read set.",
          );
        }
        const file = await readVerifiedRegularFile(
          requestedPath,
          policy.requestRoot,
          "ACP read target",
        );
        checkActive();
        const { bytes } = file;
        if (bytes.byteLength !== authorized.byteLength || sha256(bytes) !== authorized.sha256) {
          throw policyError(
            "ACP_FROZEN_INPUT_DRIFT",
            "A frozen input changed after the ACP session started.",
          );
        }
        event("file-read", { role: authorized.role });
        return { content: slicedLines(bytes.toString("utf8"), params.line, params.limit) };
      });
    },
    async writeTextFile(params, signal) {
      return trackActive(signal, () => mutate(signal, async (checkActive) => {
        validateSession(sessionId, params.sessionId);
        const requestedPath = assertAbsolutePath(params.path, "fs/write_text_file path");
        if (requestedPath !== policy.outputPath) {
          throw policyError(
            "ACP_WRITE_NOT_AUTHORIZED",
            "Qoder may only write the exact Candidate output path.",
          );
        }
        let temporaryPath = null;
        try {
          if (await fileExists(policy.completionPath)) {
            throw policyError(
              "ACP_OUTPUT_ALREADY_FINALIZED",
              "The Candidate output is immutable after finalization.",
            );
          }
          checkActive();
          if (finalizerStarted) {
            throw policyError(
              "ACP_FINALIZER_ALREADY_STARTED",
              "The Candidate output is immutable once finalization starts.",
            );
          }
          if (outputWritten) {
            throw policyError(
              "ACP_OUTPUT_ALREADY_WRITTEN",
              "The synthetic Candidate output accepts exactly one committed write.",
            );
          }
          if (typeof params.content !== "string" || !params.content.trim()) {
            throw policyError("ACP_OUTPUT_EMPTY", "The Candidate output must not be empty.");
          }
          const bytes = Buffer.from(params.content, "utf8");
          if (bytes.byteLength > MAX_HTML_BYTES) {
            throw policyError("ACP_OUTPUT_TOO_LARGE", "The Candidate output exceeds 20 MiB.");
          }
          await verifiedOutputParent(policy.outputPath, policy.requestRoot);
          checkActive();
          try {
            const existing = await lstat(policy.outputPath);
            if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1) {
              throw policyError(
                "ACP_UNSAFE_OUTPUT_FILE",
                "The Candidate output must be a single-link regular file.",
              );
            }
            throw policyError(
              "ACP_OUTPUT_ALREADY_WRITTEN",
              "The synthetic Candidate output must be fresh before its single committed write.",
            );
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          checkActive();
          temporaryPath = `${policy.outputPath}.pageroot-acp-${randomUUID()}.tmp`;
          const flags = fsConstants.O_WRONLY
            | fsConstants.O_CREAT
            | fsConstants.O_EXCL
            | (fsConstants.O_NOFOLLOW || 0);
          const handle = await open(temporaryPath, flags, 0o600);
          try {
            const information = await handle.stat();
            if (!information.isFile() || information.nlink !== 1) {
              throw policyError(
                "ACP_UNSAFE_OUTPUT_FILE",
                "The Candidate output staging file must be a single-link regular file.",
              );
            }
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          checkActive();
          await renameOutput(temporaryPath, policy.outputPath);
          temporaryPath = null;
          try {
            checkActive();
          } catch (error) {
            const published = await readVerifiedRegularFile(
              policy.outputPath,
              policy.requestRoot,
              "Cancelled Candidate output",
            );
            if (sha256(published.bytes) === sha256(bytes)) {
              await unlink(policy.outputPath);
            }
            throw error;
          }
          outputWritten = true;
          event("file-written", { byteLength: bytes.byteLength });
          return {};
        } finally {
          if (temporaryPath) await unlink(temporaryPath).catch(() => {});
        }
      }));
    },
    async createTerminal(params, signal) {
      return trackActive(signal, () => mutate(signal, async (checkActive) => {
        validateSession(sessionId, params.sessionId);
        if (finalizerStarted) {
          throw policyError(
            "ACP_FINALIZER_ALREADY_STARTED",
            "The task finalizer can be launched only once.",
          );
        }
        if (!finalizerRequestMatches(params, policy.finalizer)) {
          throw policyError(
            "ACP_TERMINAL_NOT_AUTHORIZED",
            "The ACP terminal may execute only the frozen PageRoot finalizer.",
          );
        }
        const outputInformation = await readVerifiedRegularFile(
          policy.outputPath,
          policy.requestRoot,
          "Candidate output",
        );
        checkActive();
        if (
          outputInformation.information.size <= 0
          || outputInformation.information.size > MAX_HTML_BYTES
        ) {
          throw policyError(
            "ACP_OUTPUT_NOT_READY",
            "The Candidate output is not ready for finalization.",
          );
        }
        finalizerStarted = true;
        finalizedOutputSha256 = sha256(outputInformation.bytes);
        const outputByteLimit = terminalOutputLimit(params.outputByteLimit);
        const child = spawnProcess(policy.finalizer.command, [...policy.finalizer.args], {
          cwd: policy.finalizer.cwd,
          env: { ...policy.finalizer.env },
          detached: process.platform !== "win32",
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const terminalId = `term_${randomUUID().replaceAll("-", "")}`;
        const record = {
          child,
          processGroup: process.platform !== "win32",
          output: "",
          outputByteLimit,
          truncated: false,
          exitPromise: null,
        };
        const append = (chunk) => {
          const next = truncateUtf8Tail(record.output + chunk.toString(), outputByteLimit);
          record.output = next.value;
          record.truncated ||= next.truncated;
        };
        child.stdout?.on("data", append);
        child.stderr?.on("data", append);
        record.exitPromise = waitForExit(child).then((status) => {
          finalizerOutcome = {
            status,
            truncated: record.truncated,
          };
          event("terminal-exited", { exitCode: status?.exitCode ?? null });
          return status;
        });
        void record.exitPromise.catch(() => {});
        terminals.set(terminalId, record);
        event("terminal-created", { executable: path.basename(policy.finalizer.command) });
        return { terminalId };
      }));
    },
    async terminalOutput(params, signal) {
      return trackActive(signal, async () => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        return {
          output: record.output,
          truncated: record.truncated,
          ...(terminalExitStatus(record.child)
            ? { exitStatus: terminalExitStatus(record.child) }
            : {}),
        };
      });
    },
    async waitForTerminalExit(params, signal) {
      return trackActive(signal, async (checkActive) => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        const status = await record.exitPromise;
        checkActive();
        return status;
      });
    },
    async killTerminal(params, signal) {
      return trackActive(signal, async () => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        if (record.child.exitCode === null && record.child.signalCode === null) {
          signalProcess(record.child, "SIGTERM", { processGroup: record.processGroup });
        }
        event("terminal-killed");
        return {};
      });
    },
    async releaseTerminal(params, signal) {
      return trackActive(signal, async (checkActive) => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        await terminateProcess(record.child, { processGroup: record.processGroup });
        await record.exitPromise.catch(() => {});
        checkActive();
        terminals.delete(params.terminalId);
        event("terminal-released");
        return {};
      });
    },
    async assertTurnCompleted() {
      return trackActive(null, async (checkActive) => {
        if (
          !finalizerStarted
          || !finalizerOutcome
          || finalizerOutcome.status?.exitCode !== 0
          || finalizerOutcome.status?.signal
          || finalizerOutcome.truncated
        ) {
          throw policyError(
            "ACP_FINALIZER_NOT_COMPLETED",
            "The ACP turn stopped without one clean, complete PageRoot finalizer run.",
          );
        }
        const [output, completionFile] = await Promise.all([
          readVerifiedRegularFile(policy.outputPath, policy.requestRoot, "Finalized Candidate"),
          readVerifiedRegularFile(policy.completionPath, policy.requestRoot, "Completion record"),
        ]);
        checkActive();
        const currentOutputSha256 = sha256(output.bytes);
        if (currentOutputSha256 !== finalizedOutputSha256) {
          throw policyError(
            "ACP_FINALIZED_OUTPUT_CHANGED",
            "The Candidate output changed during or after finalization.",
          );
        }
        let completion;
        try {
          completion = JSON.parse(completionFile.bytes.toString("utf8"));
        } catch {
          throw policyError(
            "ACP_COMPLETION_INVALID",
            "The finalizer did not write a valid completion record.",
          );
        }
        const projectRoot = projectRootForRequest(policy.requestRoot, policy.requestId);
        const controlRoot = path.join(projectRoot, ".pageroot");
        const outputRelativePath = path.relative(controlRoot, policy.outputPath).split(path.sep).join("/");
        if (
          completion?.projectId !== policy.projectId
          || completion?.documentId !== policy.documentId
          || completion?.requestId !== policy.requestId
          || completion?.attemptId !== policy.attemptId
          || completion?.inputManifestSha256 !== policy.inputManifestSha256
          || completion?.outputRelativePath !== outputRelativePath
          || completion?.outputSha256 !== currentOutputSha256
          || !["completed", "no-change"].includes(completion?.status)
        ) {
          throw policyError(
            "ACP_COMPLETION_IDENTITY_MISMATCH",
            "The completion record does not match the frozen PageRoot task and Candidate.",
          );
        }
        checkActive();
        phase = "finalized";
        event("completion-verified", { status: completion.status });
        return Object.freeze({
          status: completion.status,
          outputSha256: currentOutputSha256,
        });
      });
    },
    async cancel() {
      if (cancellationRequested || phase !== "active") {
        return cancellationPromise || Promise.resolve();
      }
      cancellationRequested = true;
      event("host-cancelling");
      cancellationPromise = (async () => {
        const release = await acquireMutationLock();
        try {
          if (phase === "active") phase = "cancelling";
        } finally {
          release();
        }
        await stopTerminals();
      })();
      await cancellationPromise;
    },
    async dispose() {
      if (phase === "disposed") return;
      phase = "disposed";
      await cancellationPromise?.catch(() => {});
      await stopTerminals();
      await Promise.allSettled([...inFlight]);
    },
  };
  return host;
}

function buildClient(host) {
  return acp
    .client({ name: "pageroot-qoder-acp-spike" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => (
      host.requestPermission(params, signal)
    ))
    .onRequest(acp.methods.client.fs.readTextFile, ({ params, signal }) => (
      host.readTextFile(params, signal)
    ))
    .onRequest(acp.methods.client.fs.writeTextFile, ({ params, signal }) => (
      host.writeTextFile(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.create, ({ params, signal }) => (
      host.createTerminal(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.output, ({ params, signal }) => (
      host.terminalOutput(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.waitForExit, ({ params, signal }) => (
      host.waitForTerminalExit(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.kill, ({ params, signal }) => (
      host.killTerminal(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.release, ({ params, signal }) => (
      host.releaseTerminal(params, signal)
    ));
}

function timeoutController(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("ACP timeouts must be positive integers.");
  }
  const controller = new AbortController();
  let rejectExpired;
  const expired = new Promise((_resolve, reject) => {
    rejectExpired = reject;
  });
  const timer = setTimeout(() => {
    const error = policyError("ACP_TIMEOUT", "The ACP operation timed out.");
    rejectExpired(error);
    controller.abort(error);
  }, timeoutMs);
  return {
    controller,
    expired,
    clear() {
      clearTimeout(timer);
    },
  };
}

function summarizeUpdate(update) {
  const type = String(update?.sessionUpdate || "unknown");
  if (type === "tool_call" || type === "tool_call_update") {
    return {
      type,
      toolKind: String(update.kind || "unknown"),
      status: String(update.status || "unknown"),
    };
  }
  return { type };
}

export async function runAcpTask({
  connection,
  policy,
  prompt,
  onEvent = () => {},
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
}) {
  const isStream = Boolean(connection?.readable && connection?.writable);
  const isAgentApp = typeof connection?.connect === "function"
    && typeof connection?.connectWith === "function";
  if (!isStream && !isAgentApp) {
    throw new TypeError("An ACP Stream or AgentApp connection is required.");
  }
  const host = createRestrictedQoderAcpHost(policy, { onEvent });
  const client = buildClient(host);
  const startupTimeout = timeoutController(startupTimeoutMs);
  const updates = [];
  const cancelStartup = () => {
    void host.cancel().catch(() => {});
  };
  startupTimeout.controller.signal.addEventListener("abort", cancelStartup, { once: true });
  try {
    return await client.connectWith(connection, async (context) => {
      const initialized = await Promise.race([
        context.request(
          acp.methods.agent.initialize,
          {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: true,
            },
            clientInfo: {
              name: "pageroot-qoder-acp-spike",
              title: "PageRoot Qoder ACP Spike",
              version: "0.1.0",
            },
          },
          { cancellationSignal: startupTimeout.controller.signal },
        ),
        startupTimeout.expired,
      ]);
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw policyError(
          "ACP_PROTOCOL_UNSUPPORTED",
          `Qoder selected unsupported ACP protocol ${initialized.protocolVersion}.`,
        );
      }
      onEvent(Object.freeze({
        kind: "initialized",
        protocolVersion: initialized.protocolVersion,
        agentName: initialized.agentInfo?.name || "unknown",
        agentVersion: initialized.agentInfo?.version || "unknown",
      }));

      const session = await Promise.race([
        context.buildSession({
          cwd: policy.requestRoot,
          mcpServers: [],
        }).start({ cancellationSignal: startupTimeout.controller.signal }),
        startupTimeout.expired,
      ]);
      startupTimeout.clear();
      host.bindSessionId(session.sessionId);
      const turnTimeout = timeoutController(turnTimeoutMs);
      const cancelTurn = () => {
        void host.cancel().catch(() => {});
        void context.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        }).catch(() => {});
      };
      turnTimeout.controller.signal.addEventListener("abort", cancelTurn, { once: true });
      try {
        const promptPromise = session.prompt(prompt, {
          cancellationSignal: turnTimeout.controller.signal,
        });
        void promptPromise.catch(() => {});
        for (;;) {
          const message = await Promise.race([
            session.nextUpdate(),
            turnTimeout.expired,
          ]);
          if (message.kind === "stop") {
            const completion = await host.assertTurnCompleted();
            onEvent(Object.freeze({ kind: "turn-stopped", stopReason: message.stopReason }));
            return {
              initialized,
              sessionId: session.sessionId,
              stopReason: message.stopReason,
              completion,
              updates,
            };
          }
          const summary = summarizeUpdate(message.update);
          updates.push(summary);
          onEvent(Object.freeze({ kind: "session-update", ...summary }));
        }
      } finally {
        turnTimeout.controller.signal.removeEventListener("abort", cancelTurn);
        turnTimeout.clear();
        session.dispose();
      }
    });
  } finally {
    startupTimeout.controller.signal.removeEventListener("abort", cancelStartup);
    startupTimeout.clear();
    await host.dispose();
  }
}

function signalProcessGroup(child, signal) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function signalProcess(child, signal, { processGroup = false } = {}) {
  if (processGroup && Number.isSafeInteger(child?.pid) && child.pid > 0) {
    if (signalProcessGroup(child, signal)) return;
  }
  if (Number.isSafeInteger(child?.pid) && child.pid > 0) {
    try {
      child.kill(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

function processGroupExists(child) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(child);
}

async function terminateProcess(child, { processGroup = false } = {}) {
  if (!child) return;
  const alreadyExited = child.exitCode !== null || child.signalCode !== null;
  signalProcess(child, "SIGTERM", { processGroup });
  if (!alreadyExited) {
    const exited = await Promise.race([
      waitForExit(child).then(() => true, () => true),
      new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_GRACE_MS, false)),
    ]);
    if (!exited && child.exitCode === null && child.signalCode === null) {
      signalProcess(child, "SIGKILL", { processGroup });
    }
  }
  await waitForExit(child).catch(() => {});
  if (
    processGroup
    && processGroupExists(child)
    && !(await waitForProcessGroupExit(child, PROCESS_EXIT_GRACE_MS))
  ) {
    signalProcessGroup(child, "SIGKILL");
    await waitForProcessGroupExit(child, PROCESS_EXIT_GRACE_MS);
  } else if (!processGroup && child.exitCode === null && child.signalCode === null) {
    signalProcess(child, "SIGKILL", { processGroup });
    await waitForExit(child).catch(() => {});
  }
}

export async function runQoderAcpTask({
  command,
  args = ["--acp"],
  policy,
  prompt,
  environment = {},
  onEvent = () => {},
  startupTimeoutMs,
  turnTimeoutMs,
}) {
  const requestedExecutable = assertAbsolutePath(command, "Qoder ACP command");
  const executable = await realpath(requestedExecutable).catch(() => {
    throw policyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is unavailable.");
  });
  const executableInformation = await lstat(executable);
  if (!executableInformation.isFile() || executableInformation.isSymbolicLink()) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_INVALID",
      "The ACP Agent executable must resolve to a regular file.",
    );
  }
  await access(executable, fsConstants.X_OK).catch(() => {
    throw policyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is not executable.");
  });
  const stderr = { value: "", truncated: false };
  const processGroup = process.platform !== "win32";
  const child = spawn(executable, [...args], {
    cwd: policy.requestRoot,
    env: qoderEnvironment(environment),
    detached: processGroup,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const childExitPromise = waitForExit(child);
  void childExitPromise.catch(() => {});
  const earlyExitPromise = childExitPromise.then(
    async (status) => {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_PROTOCOL_DRAIN_MS));
      throw policyError(
        "ACP_AGENT_EXITED_EARLY",
        "The ACP Agent process exited before the task completed.",
        { status },
      );
    },
    (cause) => {
      const error = policyError(
        "ACP_AGENT_PROCESS_ERROR",
        "The ACP Agent process could not be started or observed.",
      );
      error.cause = cause;
      throw error;
    },
  );
  void earlyExitPromise.catch(() => {});
  child.stdin?.on("error", () => {});
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    const next = truncateUtf8Tail(stderr.value + chunk, 16 * 1024);
    stderr.value = next.value;
    stderr.truncated ||= next.truncated;
  });
  const guardedStdout = child.stdout.pipe(new AcpFrameGuard());
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(guardedStdout),
  );
  try {
    const result = await Promise.race([
      runAcpTask({
        connection: stream,
        policy,
        prompt,
        onEvent,
        ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
      }),
      earlyExitPromise,
    ]);
    return {
      ...result,
      stderr: stderr.value,
      stderrTruncated: stderr.truncated,
    };
  } catch (cause) {
    let failure = cause;
    if (String(cause?.message || cause) === "ACP connection closed") {
      const status = await Promise.race([
        childExitPromise.then(
          (value) => value,
          () => null,
        ),
        new Promise((resolve) => setTimeout(resolve, 50, null)),
      ]);
      if (status) {
        failure = policyError(
          "ACP_AGENT_EXITED_EARLY",
          "The ACP Agent process exited before the task completed.",
          { status },
        );
      }
    }
    const error = failure instanceof Error ? failure : new Error(String(failure));
    error.qoderStderr = stderr.value;
    error.qoderStderrTruncated = stderr.truncated;
    throw error;
  } finally {
    child.stdin?.end();
    await terminateProcess(child, { processGroup });
  }
}
