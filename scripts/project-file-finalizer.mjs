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

function normalizedPath(value) {
  return path.resolve(String(value || "")).normalize("NFC");
}

function inside(root, candidate) {
  const resolvedRoot = normalizedPath(root);
  const resolvedCandidate = normalizedPath(candidate);
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
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
    "inputRelativePath",
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
  const expectedOutput = `requests/${requestId}/attempts/${attemptId}/output/candidate.html`;
  if (
    record.inputRelativePath !== expectedInput
    || record.outputRelativePath !== expectedOutput
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PATH_MISMATCH",
      "The Request output path is not the one frozen for this Attempt.",
    );
  }
  return record;
}

export async function finalizeProjectFileAttempt({
  projectRoot,
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
  const inputPath = path.join(controlRoot, ...record.inputRelativePath.split("/"));
  const outputPath = path.join(controlRoot, ...record.outputRelativePath.split("/"));
  if (!inside(controlRoot, inputPath) || !inside(controlRoot, outputPath)) {
    throw new ProjectFileFinalizerError("PATH_ESCAPES_PROJECT", "A frozen Request path escapes its project.");
  }
  await regularFile(inputPath, "Frozen Request input");
  const input = await readFile(inputPath);
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
