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
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_SESSION_UPDATES = 512;
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
const VERIFIED_ESM_LOADER_SOURCE = `
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";

const identifier = pathToFileURL(process.argv[1]).href;
const require = createRequire(identifier);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
const resolveSpecifier = (specifier) => {
  if (specifier.startsWith("node:")) return specifier;
  if (builtins.has(specifier)) return "node:" + specifier;
  if (/^[a-zA-Z][a-zA-Z+.-]*:/u.test(specifier)) return specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return new URL(specifier, identifier).href;
  }
  return pathToFileURL(require.resolve(specifier)).href;
};
const externalModules = new Map();
const linkExternal = async (specifier) => {
  const resolved = resolveSpecifier(specifier);
  if (!externalModules.has(resolved)) {
    externalModules.set(resolved, import(resolved).then((namespace) => {
      const names = Object.keys(namespace);
      return new SyntheticModule(names, function initialize() {
        for (const name of names) this.setExport(name, namespace[name]);
      }, { identifier: resolved });
    }));
  }
  return externalModules.get(resolved);
};
const module = new SourceTextModule(readFileSync(3, "utf8"), {
  identifier,
  initializeImportMeta(meta) {
    meta.url = identifier;
    meta.filename = fileURLToPath(identifier);
    meta.dirname = dirname(meta.filename);
    meta.resolve = (specifier) => resolveSpecifier(specifier);
  },
  importModuleDynamically: async (specifier) => {
    const dependency = await linkExternal(specifier);
    if (dependency.status === "unlinked") await dependency.link(() => {});
    if (dependency.status === "linked") await dependency.evaluate();
    return dependency;
  },
});
await module.link(linkExternal);
await module.evaluate();
`;

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

function sameExecutableIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.sha256 === right.sha256,
  );
}

async function readHandleAtStart(handle, size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable size is invalid.",
    );
  }
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return bytes.subarray(0, offset);
}

async function openVerifiedAgentExecutable(executable, expectedExecutable) {
  const expectedPath = assertAbsolutePath(expectedExecutable?.path, "expected Qoder executable");
  if (executable !== expectedPath) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable path changed after PageRoot preflight.",
    );
  }
  const handle = await open(
    executable,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  ).catch(() => {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable could not be reopened after PageRoot preflight.",
    );
  });
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o022) !== 0) {
      throw policyError(
        "ACP_AGENT_EXECUTABLE_CHANGED",
        "The ACP Agent executable is no longer a protected regular file.",
      );
    }
    // Positional reads leave the inherited file description at byte zero so
    // the trusted runtime can consume these exact verified bytes through fd 3.
    const bytes = await readHandleAtStart(handle, before.size);
    const after = await handle.stat();
    const identity = {
      dev: after.dev,
      ino: after.ino,
      nlink: after.nlink,
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256: sha256(bytes),
    };
    if (
      !sameFileIdentity(before, after)
      || bytes.byteLength !== after.size
      || !sameExecutableIdentity(identity, expectedExecutable.identity)
    ) {
      throw policyError(
        "ACP_AGENT_EXECUTABLE_CHANGED",
        "The ACP Agent executable identity changed after PageRoot preflight.",
      );
    }
    return handle;
  } catch (cause) {
    await handle.close().catch(() => {});
    throw cause;
  }
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

async function canonicalFuturePath(value, label) {
  const requested = assertAbsolutePath(value, label);
  const canonicalParent = await realpath(path.dirname(requested));
  return path.join(canonicalParent, path.basename(requested));
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
    env: Object.freeze(process.versions.electron
      ? { ELECTRON_RUN_AS_NODE: "1" }
      : {}),
    cwd: requestRoot,
  });
}

async function assertRuntimeProcessingAuthority(policy) {
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
      "ACP_RUNTIME_AUTHORITY_DRIFT",
      "PageRoot no longer authorizes mutations for this ACP Attempt.",
    );
  }
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
      "The Qoder ACP driver only accepts PageRoot's exact current frozen input manifest shape.",
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
      "ACP_OUTPUT_ATTEMPT_MISMATCH",
      "The Candidate output does not belong to the authorized Attempt.",
    );
  }
  if (await fileExists(normalizedOutputPath)) {
    throw policyError(
      "ACP_OUTPUT_PREEXISTS",
      "The Qoder ACP driver requires a fresh Attempt output path.",
    );
  }

  const normalizedCompletionPath = await canonicalFuturePath(
    completionPath,
    "completionPath",
  );
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
      "The Qoder ACP driver requires a fresh Attempt completion path.",
    );
  }

  const normalizedFinalizer = await officialFinalizer({
    requestRoot,
    requestId,
    attemptId,
  });

  return Object.freeze({
    [POLICY_BRAND]: true,
    // The shared ACP driver selects its host, its declared client capabilities
    // and its completion requirement from this mode, so it stays explicit here
    // instead of being inferred from a missing field.
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
    finalizer: normalizedFinalizer,
  });
}

// The Discussion Host is deliberately not the Execution Host with a different
// read list. Discussion has no Request, no Candidate, no finalizer and no
// runtime authority: it reads exactly one short-lived read-only snapshot of the
// page the user is looking at, plus the discussion prompt, and nothing else. It
// can never write, spawn a terminal or touch `activeRequest`.
export async function loadQoderAcpDiscussionPolicy(options) {
  const value = assertObject(options, "ACP discussion policy options");
  const allowedOptionNames = new Set(["snapshotRoot", "snapshotName", "promptName"]);
  const unexpectedOption = Object.keys(value).find(
    (name) => !allowedOptionNames.has(name),
  );
  if (unexpectedOption) {
    throw policyError(
      "ACP_DISCUSSION_OPTIONS_INVALID",
      `ACP discussion policy options contain unsupported field ${JSON.stringify(unexpectedOption)}.`,
    );
  }
  const { snapshotRoot, snapshotName = "snapshot.html", promptName = "PROMPT.md" } = value;
  // Names are single, safe filename segments joined to the canonical root, so a
  // caller cannot point the snapshot at a path outside the short-lived dir.
  const safeName = (name, label) => {
    const text = assertNonEmptyString(name, label);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u.test(text) || text.includes("..")) {
      throw policyError("ACP_DISCUSSION_NAME_INVALID", `${label} must be a safe file name.`);
    }
    return text;
  };
  const safeSnapshotName = safeName(snapshotName, "snapshotName");
  const safePromptName = safeName(promptName, "promptName");
  if (safeSnapshotName === safePromptName) {
    throw policyError(
      "ACP_DISCUSSION_READ_ORDER_DUPLICATE",
      "The discussion snapshot and prompt must be distinct files.",
    );
  }
  const requestedRoot = assertAbsolutePath(snapshotRoot, "snapshotRoot");
  const rootInformation = await lstat(requestedRoot);
  if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
    throw policyError(
      "ACP_DISCUSSION_UNSAFE_ROOT",
      "The discussion snapshot root must be a real directory.",
    );
  }
  const snapshotRootPath = await realpath(requestedRoot);

  const snapshot = await readVerifiedRegularFile(
    path.join(snapshotRootPath, safeSnapshotName),
    snapshotRootPath,
    "Discussion snapshot",
  );
  if (snapshot.bytes.byteLength > MAX_HTML_BYTES) {
    throw policyError("ACP_DISCUSSION_SNAPSHOT_TOO_LARGE", "The discussion snapshot exceeds 20 MiB.");
  }
  const prompt = await readVerifiedRegularFile(
    path.join(snapshotRootPath, safePromptName),
    snapshotRootPath,
    "Discussion prompt",
  );
  if (prompt.bytes.byteLength > MAX_PROMPT_BYTES) {
    throw policyError("ACP_DISCUSSION_PROMPT_TOO_LARGE", "The discussion prompt exceeds 256 KiB.");
  }

  return Object.freeze({
    [POLICY_BRAND]: true,
    mode: "discussion",
    requestRoot: snapshotRootPath,
    snapshotPath: snapshot.path,
    promptPath: prompt.path,
    sourceSha256: sha256(snapshot.bytes),
    // No outputPath, no finalizer, no runtimePath: discussion cannot mutate.
    readableFiles: Object.freeze([
      Object.freeze({
        path: snapshot.path,
        role: "discussion-snapshot",
        sha256: sha256(snapshot.bytes),
        byteLength: snapshot.bytes.byteLength,
      }),
      Object.freeze({
        path: prompt.path,
        role: "prompt",
        sha256: sha256(prompt.bytes),
        byteLength: prompt.bytes.byteLength,
      }),
    ]),
  });
}

// A minimal restricted host for discussion turns. It shares the execution
// host's file-safety and drift checks for reads, and hard-denies every
// mutation: no write path exists, terminals are refused, and tool-permission
// requests are always cancelled. Nothing here can create a Candidate.
export function createRestrictedDiscussionHost(policy, { onEvent = () => {} } = {}) {
  assertObject(policy, "policy");
  if (
    policy[POLICY_BRAND] !== true
    || policy.mode !== "discussion"
    || !Array.isArray(policy.readableFiles)
  ) {
    throw new TypeError("Restricted discussion host requires a verified discussion policy.");
  }
  if (typeof onEvent !== "function") {
    throw new TypeError("Restricted discussion host dependencies are invalid.");
  }
  let sessionId = null;
  let phase = "active";
  let cancellationRequested = false;
  const readableFiles = new Map(
    policy.readableFiles.map((entry) => [entry.path, entry]),
  );
  const event = (kind, details = {}) => onEvent(Object.freeze({ kind, ...details }));
  // `buildClient` registers the whole terminal surface for every host, so every
  // terminal method must refuse with this policy error instead of failing as an
  // undefined-method TypeError.
  const noTerminal = () => policyError(
    "ACP_DISCUSSION_NO_TERMINAL",
    "A discussion turn cannot use a terminal.",
  );
  const assertActive = (signal) => {
    if (signal?.aborted) {
      throw policyError("ACP_REQUEST_CANCELLED", "The ACP request was cancelled.");
    }
    if (cancellationRequested || phase === "cancelling") {
      throw policyError("ACP_HOST_CANCELLING", "The discussion host is cancelling.");
    }
    if (phase === "disposed") {
      throw policyError("ACP_HOST_DISPOSED", "The discussion host is already closed.");
    }
  };

  return {
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
    async requestPermission(params) {
      validateSession(sessionId, params.sessionId);
      // Discussion needs no tool that requires permission; always decline.
      event("permission-rejected", { toolKind: params.toolCall?.kind || "unknown" });
      return { outcome: { outcome: "cancelled" } };
    },
    async readTextFile(params, signal) {
      assertActive(signal);
      validateSession(sessionId, params.sessionId);
      const requestedPath = assertAbsolutePath(params.path, "fs/read_text_file path");
      const authorized = readableFiles.get(requestedPath);
      if (!authorized) {
        throw policyError(
          "ACP_READ_NOT_AUTHORIZED",
          "Qoder requested a file outside the discussion snapshot.",
        );
      }
      const file = await readVerifiedRegularFile(
        requestedPath,
        policy.requestRoot,
        "ACP discussion read target",
      );
      assertActive(signal);
      const { bytes } = file;
      if (bytes.byteLength !== authorized.byteLength || sha256(bytes) !== authorized.sha256) {
        throw policyError(
          "ACP_FROZEN_INPUT_DRIFT",
          "The discussion snapshot changed after the session started.",
        );
      }
      event("file-read", { role: authorized.role });
      return { content: slicedLines(bytes.toString("utf8"), params.line, params.limit) };
    },
    async writeTextFile() {
      throw policyError(
        "ACP_DISCUSSION_READONLY",
        "A discussion turn cannot write any file.",
      );
    },
    async createTerminal() {
      throw noTerminal();
    },
    async terminalOutput() {
      throw noTerminal();
    },
    async waitForTerminalExit() {
      throw noTerminal();
    },
    async killTerminal() {
      throw noTerminal();
    },
    async releaseTerminal() {
      throw noTerminal();
    },
    cancel() {
      cancellationRequested = true;
      if (phase === "active") phase = "cancelling";
      return Promise.resolve();
    },
    dispose() {
      phase = "disposed";
    },
  };
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

export function qoderAcpEnvironment(overrides = {}, baseEnvironment = process.env) {
  assertObject(overrides, "Qoder environment");
  assertObject(baseEnvironment, "Qoder base environment");
  const result = {};
  for (const name of SAFE_QODER_ENVIRONMENT_NAMES) {
    if (typeof baseEnvironment[name] === "string") result[name] = baseEnvironment[name];
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
  const terminal = terminalExitStatus(child);
  if (terminal) return terminal;
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
      await assertRuntimeProcessingAuthority(policy);
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
          await assertRuntimeProcessingAuthority(policy);
          checkActive();
          await renameOutput(temporaryPath, policy.outputPath);
          temporaryPath = null;
          try {
            checkActive();
            await assertRuntimeProcessingAuthority(policy);
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
        await assertRuntimeProcessingAuthority(policy);
        checkActive();
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
    .client({ name: "pageroot-agent-bridge" })
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

function cancellationGate(signal) {
  if (signal !== undefined && signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("ACP cancellationSignal must be an AbortSignal.");
  }
  if (!signal) {
    return {
      promise: new Promise(() => {}),
      dispose() {},
    };
  }
  let rejectCancelled;
  const promise = new Promise((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const cancel = () => {
    const reason = policyError("ACP_CANCELLED", "The PageRoot ACP task was cancelled.");
    if (signal.reason instanceof Error) reason.cause = signal.reason;
    rejectCancelled(reason);
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return {
    promise,
    dispose() {
      signal.removeEventListener("abort", cancel);
    },
  };
}

function combinedSignal(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function normalizedAgentInfo(value) {
  const agentInfo = value && typeof value === "object" ? value : {};
  const clean = (input, fallback) => {
    const normalized = String(input || fallback)
      .replace(/[\u0000-\u001f\u007f]/gu, "")
      .trim()
      .slice(0, 160);
    return normalized || fallback;
  };
  return Object.freeze({
    name: clean(agentInfo.name, "unknown"),
    version: clean(agentInfo.version, "unknown"),
  });
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

// ADR 0036: a discussion turn may pass visible Agent text through, bounded and
// sanitized. Only what the Agent says is captured; `agent_thought_chunk` and
// every other update type are dropped, so hidden reasoning never leaves the
// driver. An execution turn captures nothing: its payload is a file, and prose
// there would only invite confusion with Candidate authority.
function visibleTextChunk(update) {
  if (update?.sessionUpdate !== "agent_message_chunk") return "";
  if (update.content?.type !== "text") return "";
  return String(update.content.text || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
}

function visibleTextBuffer(byteLimit) {
  let text = "";
  let bytes = 0;
  let truncated = false;
  return {
    append(chunk) {
      if (!chunk || truncated) return "";
      const remaining = byteLimit - bytes;
      if (remaining <= 0) {
        truncated = true;
        return "";
      }
      const size = Buffer.byteLength(chunk, "utf8");
      if (size <= remaining) {
        text += chunk;
        bytes += size;
        return chunk;
      }
      // Cut on a character boundary, then stop accepting text. A clipped reply
      // must be marked, never silently shortened.
      const kept = truncateUtf8Tail(chunk, remaining);
      text += kept.value;
      bytes += Buffer.byteLength(kept.value, "utf8");
      truncated = true;
      return kept.value;
    },
    get value() {
      return text;
    },
    get truncated() {
      return truncated;
    },
  };
}

// `buildClient` wires every one of these to the host, and the driver itself
// binds, cancels and disposes it. A host that cannot answer all of them would
// fail as an undefined-method TypeError mid-turn instead of a policy error.
const ACP_HOST_METHODS = Object.freeze([
  "bindSessionId",
  "requestPermission",
  "readTextFile",
  "writeTextFile",
  "createTerminal",
  "terminalOutput",
  "waitForTerminalExit",
  "killTerminal",
  "releaseTerminal",
  "cancel",
  "dispose",
]);

function driverProfile({
  mode,
  createHost,
  clientCapabilities,
  requiresTurnCompletion,
  visibleTextByteLimit,
  requiredHostMethods,
}) {
  return Object.freeze({
    mode,
    createHost,
    clientCapabilities,
    requiresTurnCompletion,
    visibleTextByteLimit,
    requiredHostMethods,
    assertHost(host) {
      const missing = requiredHostMethods.filter(
        (name) => typeof host?.[name] !== "function",
      );
      if (missing.length > 0) {
        throw policyError(
          "ACP_HOST_CONTRACT_INCOMPLETE",
          `The ${mode} ACP host does not implement ${missing.join(", ")}.`,
          { mode, missing },
        );
      }
      return host;
    },
  });
}

// One driver serves the two permission-separated turn kinds, and the branded
// policy is the only thing that picks between them. Dispatching on `policy.mode`
// — rather than letting a caller inject a host — makes an execution policy
// paired with a discussion host, or the reverse, structurally impossible.
const ACP_DRIVER_PROFILES = new Map([
  ["execution", driverProfile({
    mode: "execution",
    createHost: (policy, onEvent) => createRestrictedQoderAcpHost(policy, { onEvent }),
    clientCapabilities: Object.freeze({
      fs: Object.freeze({ readTextFile: true, writeTextFile: true }),
      terminal: true,
    }),
    // An execution turn only counts once the fixed finalizer has proven itself.
    requiresTurnCompletion: true,
    // ADR 0036 authorizes visible text for discussion only.
    visibleTextByteLimit: 0,
    requiredHostMethods: Object.freeze([...ACP_HOST_METHODS, "assertTurnCompleted"]),
  })],
  ["discussion", driverProfile({
    mode: "discussion",
    createHost: (policy, onEvent) => createRestrictedDiscussionHost(policy, { onEvent }),
    clientCapabilities: Object.freeze({
      fs: Object.freeze({ readTextFile: true, writeTextFile: false }),
      terminal: false,
    }),
    // Discussion produces no Candidate, so it declares that it requires no
    // completion evidence. It must never become an optional call on a method
    // that could silently disappear from the execution host.
    requiresTurnCompletion: false,
    // The reply is the whole payload of a discussion turn, so it is captured
    // within a fixed budget (ADR 0036).
    visibleTextByteLimit: 64 * 1024,
    requiredHostMethods: ACP_HOST_METHODS,
  })],
]);

export function acpDriverProfile(policy) {
  assertObject(policy, "policy");
  if (policy[POLICY_BRAND] !== true) {
    throw new TypeError("The ACP driver requires a verified PageRoot policy.");
  }
  const profile = typeof policy.mode === "string"
    ? ACP_DRIVER_PROFILES.get(policy.mode)
    : undefined;
  if (!profile) {
    throw policyError(
      "ACP_POLICY_MODE_UNSUPPORTED",
      "The ACP driver does not support this policy mode.",
    );
  }
  return profile;
}

export async function runAcpTask({
  connection,
  policy,
  prompt,
  onEvent = () => {},
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  cancellationSignal,
  expectedAgentName,
}) {
  const isStream = Boolean(connection?.readable && connection?.writable);
  const isAgentApp = typeof connection?.connect === "function"
    && typeof connection?.connectWith === "function";
  if (!isStream && !isAgentApp) {
    throw new TypeError("An ACP Stream or AgentApp connection is required.");
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TypeError("ACP prompt must be a non-empty string.");
  }
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw policyError("ACP_PROMPT_TOO_LARGE", "The ACP prompt exceeds 256 KiB.");
  }
  if (
    expectedAgentName !== undefined
    && !(expectedAgentName instanceof RegExp)
  ) {
    throw new TypeError("expectedAgentName must be a RegExp.");
  }
  const profile = acpDriverProfile(policy);
  const host = profile.assertHost(profile.createHost(policy, onEvent));
  const client = buildClient(host);
  const startupTimeout = timeoutController(startupTimeoutMs);
  const cancellation = cancellationGate(cancellationSignal);
  const updates = [];
  let droppedUpdateCount = 0;
  // Zero budget means this mode captures no prose at all (ADR 0036).
  const visibleText = visibleTextBuffer(profile.visibleTextByteLimit);
  const cancelStartup = () => {
    void host.cancel().catch(() => {});
  };
  startupTimeout.controller.signal.addEventListener("abort", cancelStartup, { once: true });
  cancellationSignal?.addEventListener("abort", cancelStartup, { once: true });
  try {
    const connected = client.connectWith(connection, async (context) => {
      const startupSignal = combinedSignal(
        startupTimeout.controller.signal,
        cancellationSignal,
      );
      const initialized = await Promise.race([
        context.request(
          acp.methods.agent.initialize,
          {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: profile.clientCapabilities,
            clientInfo: {
              name: "pageroot-agent-bridge",
              title: "PageRoot Agent Bridge",
              version: "1.0.0",
            },
          },
          { cancellationSignal: startupSignal },
        ),
        startupTimeout.expired,
        cancellation.promise,
      ]);
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw policyError(
          "ACP_PROTOCOL_UNSUPPORTED",
          `Qoder selected unsupported ACP protocol ${initialized.protocolVersion}.`,
        );
      }
      const agentInfo = normalizedAgentInfo(initialized.agentInfo);
      if (expectedAgentName) expectedAgentName.lastIndex = 0;
      if (expectedAgentName && !expectedAgentName.test(agentInfo.name)) {
        throw policyError(
          "ACP_AGENT_IDENTITY_MISMATCH",
          "The selected ACP executable did not identify itself as Qoder CLI.",
        );
      }
      onEvent(Object.freeze({
        kind: "initialized",
        protocolVersion: initialized.protocolVersion,
        agentName: agentInfo.name,
        agentVersion: agentInfo.version,
      }));

      const session = await Promise.race([
        context.buildSession({
          cwd: policy.requestRoot,
          mcpServers: [],
        }).start({ cancellationSignal: startupSignal }),
        startupTimeout.expired,
        cancellation.promise,
      ]);
      startupTimeout.clear();
      host.bindSessionId(session.sessionId);
      const turnTimeout = timeoutController(turnTimeoutMs);
      const turnSignal = combinedSignal(
        turnTimeout.controller.signal,
        cancellationSignal,
      );
      const cancelTurn = () => {
        void host.cancel().catch(() => {});
        void context.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        }).catch(() => {});
      };
      turnTimeout.controller.signal.addEventListener("abort", cancelTurn, { once: true });
      cancellationSignal?.addEventListener("abort", cancelTurn, { once: true });
      try {
        const promptPromise = session.prompt(prompt, {
          cancellationSignal: turnSignal,
        });
        void promptPromise.catch(() => {});
        for (;;) {
          const message = await Promise.race([
            session.nextUpdate(),
            turnTimeout.expired,
            cancellation.promise,
          ]);
          if (message.kind === "stop") {
            onEvent(Object.freeze({ kind: "turn-stopping", stopReason: message.stopReason }));
            // Never soften this into an optional call: for a mode that requires
            // completion, a renamed or missing method must fail the turn instead
            // of silently skipping the finalizer proof.
            const completion = profile.requiresTurnCompletion
              ? await host.assertTurnCompleted()
              : null;
            onEvent(Object.freeze({ kind: "turn-stopped", stopReason: message.stopReason }));
            return {
              initialized,
              sessionId: session.sessionId,
              stopReason: message.stopReason,
              completion,
              updates,
              droppedUpdateCount,
              visibleText: visibleText.value,
              visibleTextTruncated: visibleText.truncated,
            };
          }
          // Capture the Agent's own words before the update is reduced to a
          // summary. A mode with no text budget appends nothing.
          const chunk = visibleText.append(visibleTextChunk(message.update));
          if (chunk) onEvent(Object.freeze({ kind: "visible-text", text: chunk }));
          const summary = summarizeUpdate(message.update);
          if (updates.length < MAX_SESSION_UPDATES) {
            updates.push(summary);
            onEvent(Object.freeze({ kind: "session-update", ...summary }));
          } else {
            droppedUpdateCount += 1;
            if (droppedUpdateCount === 1) {
              onEvent(Object.freeze({ kind: "session-updates-truncated" }));
            }
          }
        }
      } finally {
        turnTimeout.controller.signal.removeEventListener("abort", cancelTurn);
        cancellationSignal?.removeEventListener("abort", cancelTurn);
        turnTimeout.clear();
        session.dispose();
      }
    });
    void connected.catch(() => {});
    return await Promise.race([connected, cancellation.promise]);
  } finally {
    startupTimeout.controller.signal.removeEventListener("abort", cancelStartup);
    cancellationSignal?.removeEventListener("abort", cancelStartup);
    startupTimeout.clear();
    cancellation.dispose();
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
    if (error?.code === "EPERM") return false;
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
    if (error?.code === "EPERM") {
      return child.exitCode === null && child.signalCode === null;
    }
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

async function waitForChildExitWithin(child, timeoutMs) {
  if (terminalExitStatus(child)) return true;
  return Promise.race([
    waitForExit(child).then(() => true, () => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
}

async function terminateProcess(child, { processGroup = false } = {}) {
  if (!child) return true;
  let leaderExited = !Number.isSafeInteger(child.pid)
    || child.exitCode !== null
    || child.signalCode !== null;
  signalProcess(child, "SIGTERM", { processGroup });
  if (!leaderExited) {
    leaderExited = await waitForChildExitWithin(child, PROCESS_EXIT_GRACE_MS);
    if (!leaderExited && child.exitCode === null && child.signalCode === null) {
      signalProcess(child, "SIGKILL", { processGroup });
      leaderExited = await waitForChildExitWithin(child, PROCESS_EXIT_GRACE_MS);
    }
  }
  if (
    processGroup
    && processGroupExists(child)
    && !(await waitForProcessGroupExit(child, PROCESS_EXIT_GRACE_MS))
  ) {
    signalProcessGroup(child, "SIGKILL");
    await waitForProcessGroupExit(child, PROCESS_EXIT_GRACE_MS);
  }
  if (processGroup) return leaderExited && !processGroupExists(child);
  return leaderExited || !Number.isSafeInteger(child.pid);
}

async function trustedCurrentJavaScriptRuntime() {
  const runtime = await realpath(process.execPath).catch(() => {
    throw policyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is unavailable.",
    );
  });
  const information = await lstat(runtime).catch(() => null);
  if (!information?.isFile() || information.isSymbolicLink()) {
    throw policyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is invalid.",
    );
  }
  await access(runtime, fsConstants.X_OK).catch(() => {
    throw policyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is not executable.",
    );
  });
  return runtime;
}

export async function prepareVerifiedQoderJavaScriptExecution({
  command,
  expectedExecutable,
  environment = {},
  baseEnvironment = process.env,
} = {}) {
  const requestedExecutable = assertAbsolutePath(command, "Qoder JavaScript command");
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
  const executableHandle = await openVerifiedAgentExecutable(executable, expectedExecutable);
  let consumed = false;
  try {
    const runtime = await trustedCurrentJavaScriptRuntime();
    const childEnvironment = qoderAcpEnvironment(environment, baseEnvironment);
    if (process.versions.electron) {
      // This capability is constructed inside PageRoot. It is deliberately
      // absent from the caller-overridable environment allowlist.
      childEnvironment.ELECTRON_RUN_AS_NODE = "1";
    }
    return Object.freeze({
      executable,
      async spawn({ args = [], cwd, detached = false, stdin = "pipe" } = {}) {
        if (consumed) {
          throw policyError(
            "ACP_AGENT_EXECUTION_CONSUMED",
            "The verified Qoder execution descriptor has already been consumed.",
          );
        }
        consumed = true;
        try {
          return spawn(runtime, [
            "--no-warnings",
            "--experimental-vm-modules",
            "--input-type=module",
            "--eval",
            VERIFIED_ESM_LOADER_SOURCE,
            "--",
            executable,
            ...args,
          ], {
            cwd,
            env: childEnvironment,
            detached,
            shell: false,
            stdio: [stdin, "pipe", "pipe", executableHandle.fd],
          });
        } finally {
          // spawn duplicates fd 3 into the child before returning. Closing the
          // parent handle cannot change the inode/bytes inherited by the child.
          await executableHandle.close().catch(() => {});
        }
      },
      async close() {
        if (consumed) return;
        consumed = true;
        await executableHandle.close().catch(() => {});
      },
    });
  } catch (cause) {
    await executableHandle.close().catch(() => {});
    throw cause;
  }
}

export async function runVerifiedQoderJavaScript({
  command,
  expectedExecutable,
  args = [],
  cwd,
  environment = {},
  baseEnvironment = process.env,
  timeoutMs = 30_000,
  maxBuffer = 128 * 1024,
  processTerminator = terminateProcess,
} = {}) {
  if (typeof processTerminator !== "function") {
    throw new TypeError("Verified Qoder process terminator must be a function.");
  }
  const prepared = await prepareVerifiedQoderJavaScriptExecution({
    command,
    expectedExecutable,
    environment,
    baseEnvironment,
  });
  const processGroup = process.platform !== "win32";
  let child;
  try {
    child = await prepared.spawn({
      args,
      cwd,
      detached: processGroup,
      stdin: "ignore",
    });
  } catch (cause) {
    await prepared.close();
    throw cause;
  }

  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.stdout?.off("data", handleStdout);
      child.stderr?.off("data", handleStderr);
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const output = () => ({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
    const fail = async (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const cleanupConfirmed = await processTerminator(child, { processGroup }).then(
        (value) => value === true,
        () => false,
      );
      const failure = cleanupConfirmed
        ? error
        : policyError(
          "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
          "The Qoder preflight process group could not be confirmed stopped.",
        );
      Object.assign(failure, output());
      reject(failure);
    };
    const append = (target, chunk, currentBytes, label) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (currentBytes + bytes.byteLength > maxBuffer) {
        const error = new Error(`Qoder ${label} exceeded the preflight output limit.`);
        error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        void fail(error);
        return currentBytes;
      }
      target.push(bytes);
      return currentBytes + bytes.byteLength;
    };
    const handleStdout = (chunk) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes, "stdout");
    };
    const handleStderr = (chunk) => {
      stderrBytes = append(stderr, chunk, stderrBytes, "stderr");
    };
    const handleError = (cause) => {
      void fail(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const handleClose = async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const captured = output();
      const cleanupConfirmed = await processTerminator(child, { processGroup }).then(
        (value) => value === true,
        () => false,
      );
      if (!cleanupConfirmed) {
        const error = policyError(
          "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
          "The Qoder preflight process group could not be confirmed stopped.",
        );
        Object.assign(error, captured);
        reject(error);
        return;
      }
      if (exitCode === 0) {
        resolve(captured);
        return;
      }
      const error = new Error(`Qoder exited with status ${exitCode ?? signal ?? "unknown"}.`);
      error.code = exitCode;
      error.signal = signal;
      Object.assign(error, captured);
      reject(error);
    };

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.once("close", (...values) => {
      void handleClose(...values);
    });
    child.once("error", handleError);
    timeoutHandle = setTimeout(() => {
      const error = new Error("Qoder preflight timed out.");
      error.code = "ETIMEDOUT";
      error.killed = true;
      void fail(error);
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
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
  cancellationSignal,
  expectedAgentName,
  expectedExecutable,
  useVerifiedJavaScriptRuntime = false,
  baseEnvironment = process.env,
}) {
  if (cancellationSignal?.aborted) {
    throw policyError("ACP_CANCELLED", "The PageRoot ACP task was cancelled.");
  }
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
  let child;
  if (useVerifiedJavaScriptRuntime) {
    if (!expectedExecutable) {
      throw policyError(
        "ACP_AGENT_EXECUTABLE_INVALID",
        "Verified JavaScript execution requires preflight executable identity.",
      );
    }
    const prepared = await prepareVerifiedQoderJavaScriptExecution({
      command: executable,
      expectedExecutable,
      environment,
      baseEnvironment,
    });
    child = await prepared.spawn({
      args,
      cwd: policy.requestRoot,
      detached: processGroup,
      stdin: "pipe",
    });
  } else {
    const executableHandle = expectedExecutable
      ? await openVerifiedAgentExecutable(executable, expectedExecutable)
      : null;
    const childEnvironment = qoderAcpEnvironment(environment, baseEnvironment);
    try {
      child = spawn(executable, [...args], {
        cwd: policy.requestRoot,
        env: childEnvironment,
        detached: processGroup,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } finally {
      await executableHandle?.close().catch(() => {});
    }
  }
  const childExitPromise = waitForExit(child);
  void childExitPromise.catch(() => {});
  let turnStopObserved = false;
  const earlyExitPromise = childExitPromise.then(
    async (status) => {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_PROTOCOL_DRAIN_MS));
      if (turnStopObserved) return new Promise(() => {});
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
    const observeEvent = (event) => {
      if (event?.kind === "turn-stopping") turnStopObserved = true;
      onEvent(event);
    };
    const result = await Promise.race([
      runAcpTask({
        connection: stream,
        policy,
        prompt,
        onEvent: observeEvent,
        cancellationSignal,
        expectedAgentName,
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
    if (!(await terminateProcess(child, { processGroup }))) {
      throw policyError(
        "ACP_PROCESS_CLEANUP_UNCONFIRMED",
        "The ACP Agent process group could not be confirmed stopped.",
      );
    }
  }
}
