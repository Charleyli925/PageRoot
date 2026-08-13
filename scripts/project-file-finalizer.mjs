import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  requireCompleteHtml,
  sha256,
} from "./lifecycle-core.mjs";
import { PROJECT_FILE_SCHEMA_VERSION } from "./project-file-repository.mjs";

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const FROZEN_REQUEST_FILES = Object.freeze([
  ["PROMPT.md", "prompt"],
  ["input/AI_RULES.md", "policy"],
  ["change-request.json", "change-request"],
  ["input/PROJECT.md", "project-rules"],
  ["input/annotations/records.json", "annotations"],
]);

export class ProjectFileFinalizerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectFileFinalizerError";
    this.code = code;
    this.details = details;
  }
}

function safeId(value, label) {
  const id = String(value || "");
  if (!SAFE_ID.test(id)) {
    throw new ProjectFileFinalizerError("INVALID_ID", `${label} is invalid.`);
  }
  return id;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value || "")).normalize("NFC");
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

function inside(root, candidate) {
  const resolvedRoot = normalizedPath(root);
  const resolvedCandidate = normalizedPath(candidate);
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function samePath(left, right) {
  const first = normalizedPath(left);
  const second = normalizedPath(right);
  if (process.platform === "darwin" || process.platform === "win32") {
    return first.toLocaleLowerCase("en-US") === second.toLocaleLowerCase("en-US");
  }
  return first === second;
}

function safeRelativePath(value, label) {
  const relative = String(value || "");
  const segments = relative.split("/");
  if (
    !relative
    || path.isAbsolute(relative)
    || relative.includes("\\0")
    || relative.includes("\\")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      `${label} is not a safe Request-relative path.`,
    );
  }
  return relative;
}

function pathInside(root, relativePath, label) {
  const relative = safeRelativePath(relativePath, label);
  const candidate = path.join(root, ...relative.split("/"));
  if (!inside(root, candidate)) {
    throw new ProjectFileFinalizerError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its Request.`,
    );
  }
  return candidate;
}

function requestRelativePath(requestId, value, label) {
  const prefix = `requests/${requestId}/`;
  const relative = safeRelativePath(value, label);
  if (!relative.startsWith(prefix)) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PATH_MISMATCH",
      `${label} is not owned by this Request.`,
    );
  }
  return relative.slice(prefix.length);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function copyFileIdentity(information) {
  return {
    device: String(information.dev),
    inode: String(information.ino),
    birthtimeMs: Number(information.birthtimeMs || 0),
  };
}

function validFileIdentity(value) {
  return Boolean(
    value
    && typeof value === "object"
    && String(value.device || "")
    && String(value.inode || "")
    && Number.isFinite(Number(value.birthtimeMs))
    && Number(value.birthtimeMs) >= 0,
  );
}

function sameFileIdentity(left, right) {
  return Boolean(
    validFileIdentity(left)
    && validFileIdentity(right)
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

async function regularFile(filePath, label) {
  let information;
  try {
    information = await lstat(filePath);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new ProjectFileFinalizerError("FILE_NOT_FOUND", `${label} was not found.`);
    }
    throw cause;
  }
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new ProjectFileFinalizerError("UNSAFE_FILE", `${label} must be a regular file.`);
  }
  return information;
}

async function regularDirectory(directoryPath, label) {
  let information;
  try {
    information = await lstat(directoryPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new ProjectFileFinalizerError("DIRECTORY_NOT_FOUND", `${label} was not found.`);
    }
    throw cause;
  }
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new ProjectFileFinalizerError("UNSAFE_DIRECTORY", `${label} must be a real directory.`);
  }
  return information;
}

async function readJson(filePath, label) {
  await regularFile(filePath, label);
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (cause) {
    if (cause instanceof ProjectFileFinalizerError) throw cause;
    throw new ProjectFileFinalizerError("INVALID_JSON", `${label} is not valid JSON.`);
  }
}

function validateRequest(record, { requestId, attemptId }) {
  const required = [
    "projectId",
    "documentId",
    "candidateId",
    "expectedSourceSha256",
    "proposedVersionId",
    "proposedVersionOrdinal",
    "basedOnVersionId",
    "previousVersionId",
    "sourceWorkingCopyId",
    "inputRelativePath",
    "inputManifestRelativePath",
    "inputManifestSha256",
    "outputRelativePath",
  ];
  if (
    record.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || record.requestId !== requestId
    || record.attemptId !== attemptId
    || required.some((key) => record[key] === undefined || record[key] === null)
    || !SHA256.test(String(record.expectedSourceSha256))
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_IDENTITY_MISMATCH",
      "The Request is not a valid frozen PageRoot project-file Request.",
    );
  }
  const expectedInput = `requests/${requestId}/input/base/index.html`;
  const expectedInputManifest = `requests/${requestId}/input-manifest.json`;
  const expectedOutput = `requests/${requestId}/attempts/${attemptId}/output/candidate.html`;
  if (
    record.inputRelativePath !== expectedInput
    || record.inputManifestRelativePath !== expectedInputManifest
    || record.outputRelativePath !== expectedOutput
    || !SHA256.test(String(record.inputManifestSha256))
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PATH_MISMATCH",
      "The Request output path is not the one frozen for this Attempt.",
    );
  }
  return record;
}

function assertRequestAnchor({ record, identity, manifest, runtime }) {
  const workingCopies = Array.isArray(manifest?.workingCopies) ? manifest.workingCopies : [];
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  const workingCopy = workingCopies.find((candidate) => (
    candidate?.workingCopyId === record.sourceWorkingCopyId
  ));
  const latestVersion = versions.find((candidate) => (
    candidate?.versionId === manifest?.latestOfficialVersionId
  ));
  const expectedOrdinal = Number(latestVersion?.ordinal) + 1;
  const expectedVersionId = `ver_${String(expectedOrdinal).padStart(4, "0")}`;
  const expectedCandidateId = `candidate_${sha256(
    Buffer.from(`${identity.projectId}:${record.requestId}`, "utf8"),
  ).slice("sha256:".length, "sha256:".length + 32)}`;
  const activeRequest = runtime?.activeRequest;
  const activeMatches = Boolean(
    activeRequest
    && activeRequest.requestId === record.requestId
    && activeRequest.attemptId === record.attemptId
    && (
      (activeRequest.status === "processing" && activeRequest.candidateId === null)
      || (
        activeRequest.status === "pending-review"
        && activeRequest.candidateId === record.candidateId
        && runtime.activeCandidateId === record.candidateId
      )
    ),
  );
  if (
    manifest?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || manifest?.projectId !== identity.projectId
    || manifest?.documentId !== identity.documentId
    || !workingCopy
    || workingCopy.basedOnVersionId !== record.basedOnVersionId
    || !latestVersion
    || record.previousVersionId !== latestVersion.versionId
    || record.proposedVersionOrdinal !== expectedOrdinal
    || record.proposedVersionId !== expectedVersionId
    || record.candidateId !== expectedCandidateId
    || runtime?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || runtime?.projectId !== identity.projectId
    || runtime?.documentId !== identity.documentId
    || !activeMatches
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_IDENTITY_MISMATCH",
      "The Request no longer matches the registered project's frozen identity.",
    );
  }
}

async function verifyFrozenRequestBundle({
  requestRoot,
  record,
  identity,
}) {
  const manifestRelativePath = requestRelativePath(
    record.requestId,
    record.inputManifestRelativePath,
    "input manifest path",
  );
  const manifestPath = pathInside(requestRoot, manifestRelativePath, "input manifest path");
  await regularFile(manifestPath, "Frozen Request input manifest");
  const manifestBuffer = await readFile(manifestPath);
  if (sha256(manifestBuffer) !== record.inputManifestSha256) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest changed after submission.",
    );
  }

  let inputManifest;
  try {
    inputManifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest is not valid JSON.",
    );
  }
  if (
    !isObject(inputManifest)
    || inputManifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || inputManifest.projectId !== identity.projectId
    || inputManifest.documentId !== identity.documentId
    || inputManifest.requestId !== record.requestId
    || inputManifest.attemptId !== record.attemptId
    || inputManifest.frozen !== true
    || !Array.isArray(inputManifest.readOrder)
    || !Array.isArray(inputManifest.files)
  ) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest no longer describes this Request.",
    );
  }

  const files = new Map();
  for (const entry of inputManifest.files) {
    if (
      !isObject(entry)
      || typeof entry.role !== "string"
      || typeof entry.mediaType !== "string"
      || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 0
      || !SHA256.test(String(entry.sha256))
    ) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest contains an invalid file record.",
      );
    }
    const relativePath = safeRelativePath(entry.path, "frozen input path");
    if (files.has(relativePath)) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest contains a duplicate file path.",
      );
    }
    const filePath = pathInside(requestRoot, relativePath, "frozen input path");
    await regularFile(filePath, `Frozen Request input ${relativePath}`);
    const buffer = await readFile(filePath);
    if (buffer.byteLength !== entry.byteLength || sha256(buffer) !== entry.sha256) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        `Frozen Request input ${relativePath} changed after submission.`,
      );
    }
    files.set(relativePath, { entry, buffer });
  }

  const readOrder = new Set();
  for (const value of inputManifest.readOrder) {
    const relativePath = safeRelativePath(value, "frozen input readOrder path");
    if (readOrder.has(relativePath) || !files.has(relativePath)) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input read order is inconsistent with its inventory.",
      );
    }
    readOrder.add(relativePath);
  }

  const expectedInput = requestRelativePath(
    record.requestId,
    record.inputRelativePath,
    "frozen HTML path",
  );
  for (const [relativePath, role] of [
    ...FROZEN_REQUEST_FILES,
    [expectedInput, "base-html"],
  ]) {
    const frozen = files.get(relativePath);
    if (!frozen || frozen.entry.role !== role) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        `The frozen Request is missing its required ${role} input.`,
      );
    }
  }

  let changeRequest;
  try {
    changeRequest = JSON.parse(files.get("change-request.json").buffer.toString("utf8"));
  } catch {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen change request is not valid JSON.",
    );
  }
  const immutableKeys = [
    "projectId",
    "documentId",
    "requestId",
    "attemptId",
    "sourceWorkingCopyId",
    "expectedSourceSha256",
    "proposedVersionId",
    "proposedVersionOrdinal",
    "basedOnVersionId",
    "previousVersionId",
  ];
  if (
    !isObject(changeRequest)
    || immutableKeys.some((key) => changeRequest[key] !== record[key])
    || canonicalJson(changeRequest.requirements) !== canonicalJson(record.request || {})
  ) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "request.json no longer matches the frozen change request.",
    );
  }

  return files.get(expectedInput).buffer;
}

async function validateRegistryAuthority({
  projectRoot,
  projectsRoot,
  registryPath,
  identity,
}) {
  const configuredRoot = normalizedPath(projectsRoot || path.dirname(projectRoot));
  const expectedRegistryPath = normalizedPath(
    registryPath || path.join(configuredRoot, ".pageroot-registry.json"),
  );
  if (!samePath(path.dirname(projectRoot), configuredRoot)) {
    throw new ProjectFileFinalizerError(
      "UNREGISTERED_PROJECT_ROOT",
      "The finalizer only accepts a direct child of the configured PageRoot project directory.",
    );
  }
  await regularDirectory(configuredRoot, "configured project directory");
  const rootInformation = await regularDirectory(projectRoot, "project root");
  const registry = await readJson(expectedRegistryPath, "project Registry");
  const record = registry?.projects?.[identity.projectId];
  if (
    registry?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || !registry?.projects
    || !registry?.pendingImports
    || !record
    || typeof record !== "object"
    || !samePath(record.registeredProjectRootPath, projectRoot)
    || !validFileIdentity(record.rootFileIdentity)
  ) {
    throw new ProjectFileFinalizerError(
      "REGISTERED_PROJECT_UNAVAILABLE",
      "The project is not authorized by the v4 Registry for finalization.",
      { projectId: identity.projectId },
    );
  }
  const observedIdentity = copyFileIdentity(rootInformation);
  if (!sameFileIdentity(record.rootFileIdentity, observedIdentity)) {
    // Returning a verified project to its exact registered path may change
    // device/inode after a cross-volume move. The finalizer never follows a
    // moved path; it only refreshes this rename clue after IDs are verified.
    record.rootFileIdentity = observedIdentity;
    record.updatedAt = new Date().toISOString();
    registry.updatedAt = record.updatedAt;
    await atomicWriteJson(expectedRegistryPath, registry);
  }
  return { configuredRoot, registryPath: expectedRegistryPath };
}

export async function finalizeProjectFileAttempt({
  projectRoot,
  projectsRoot = null,
  registryPath = null,
  requestId,
  attemptId = "attempt_001",
} = {}) {
  const root = normalizedPath(projectRoot);
  const request = safeId(requestId, "requestId");
  const attempt = safeId(attemptId, "attemptId");
  await regularDirectory(root, "project root");
  const controlRoot = path.join(root, ".pageroot");
  await regularDirectory(controlRoot, ".pageroot");
  const identity = await readJson(path.join(controlRoot, "project.json"), "project.json");
  if (identity.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
    throw new ProjectFileFinalizerError(
      "UNSUPPORTED_PROJECT_SCHEMA",
      "project.json is not a supported PageRoot project-file identity.",
    );
  }
  await validateRegistryAuthority({
    projectRoot: root,
    projectsRoot,
    registryPath,
    identity,
  });
  const requestRoot = path.join(controlRoot, "requests", request);
  const record = validateRequest(
    await readJson(path.join(requestRoot, "request.json"), "request.json"),
    { requestId: request, attemptId: attempt },
  );
  if (
    record.projectId !== identity.projectId
    || record.documentId !== identity.documentId
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PROJECT_MISMATCH",
      "The Request does not belong to this project identity.",
    );
  }
  // Cancellation is a terminal user decision. A late AI finalizer must be
  // able to acknowledge it without creating completion evidence or trying to
  // re-establish the now-cleared active Request runtime anchor.
  if (record.status === "cancelled") {
    return {
      ok: true,
      status: "cancelled",
      accepted: false,
      retryable: false,
      message: "本轮已在源页结束。请停止 AI Agent，不要重试。",
    };
  }
  const [manifest, runtime] = await Promise.all([
    readJson(path.join(controlRoot, "manifest.json"), "manifest.json"),
    readJson(path.join(controlRoot, "runtime-state.json"), "runtime-state.json"),
  ]);
  assertRequestAnchor({ record, identity, manifest, runtime });
  const inputPath = path.join(controlRoot, ...record.inputRelativePath.split("/"));
  const outputPath = path.join(controlRoot, ...record.outputRelativePath.split("/"));
  if (!inside(controlRoot, inputPath) || !inside(controlRoot, outputPath)) {
    throw new ProjectFileFinalizerError("PATH_ESCAPES_PROJECT", "A frozen Request path escapes its project.");
  }
  const input = await verifyFrozenRequestBundle({
    requestRoot,
    record,
    identity,
  });
  if (sha256(input) !== record.expectedSourceSha256) {
    throw new ProjectFileFinalizerError(
      "FROZEN_INPUT_HASH_MISMATCH",
      "The frozen Request input changed after submission.",
    );
  }
  const outputInfo = await regularFile(outputPath, "Candidate output");
  if (outputInfo.size > MAX_HTML_BYTES) {
    throw new ProjectFileFinalizerError("OUTPUT_TOO_LARGE", "Candidate output is too large.");
  }
  const output = await readFile(outputPath);
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
  } catch {
    throw new ProjectFileFinalizerError("UNSUPPORTED_HTML_ENCODING", "Candidate output must be valid UTF-8.");
  }
  try {
    requireCompleteHtml(html, "Candidate output");
  } catch (cause) {
    throw new ProjectFileFinalizerError(
      "INCOMPLETE_HTML",
      cause instanceof Error ? cause.message : "Candidate output is incomplete.",
    );
  }
  const outputSha256 = sha256(output);
  const completion = {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    kind: "candidate-finalization",
    projectId: identity.projectId,
    documentId: identity.documentId,
    requestId: request,
    attemptId: attempt,
    candidateId: record.candidateId,
    proposedVersionId: record.proposedVersionId,
    proposedVersionOrdinal: record.proposedVersionOrdinal,
    basedOnVersionId: record.basedOnVersionId,
    previousVersionId: record.previousVersionId,
    expectedSourceSha256: record.expectedSourceSha256,
    inputManifestSha256: record.inputManifestSha256,
    outputRelativePath: record.outputRelativePath,
    outputSha256,
    status: outputSha256 === record.expectedSourceSha256 ? "no-change" : "completed",
    completedAt: new Date().toISOString(),
  };
  const completionPath = path.join(requestRoot, "attempts", attempt, "completion.json");
  try {
    const existing = await readJson(completionPath, "completion.json");
    if (
      existing.projectId !== completion.projectId
      || existing.documentId !== completion.documentId
      || existing.requestId !== completion.requestId
      || existing.attemptId !== completion.attemptId
      || existing.outputSha256 !== completion.outputSha256
      || existing.outputRelativePath !== completion.outputRelativePath
    ) {
      throw new ProjectFileFinalizerError(
        "COMPLETION_COLLISION",
        "A different completion is already recorded for this Attempt.",
      );
    }
    return { ok: true, replayed: true, ...existing };
  } catch (cause) {
    if (!(cause instanceof ProjectFileFinalizerError) || cause.code !== "FILE_NOT_FOUND") {
      throw cause;
    }
  }
  await atomicWriteJson(completionPath, completion);
  return { ok: true, replayed: false, ...completion };
}
