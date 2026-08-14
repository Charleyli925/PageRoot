import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  jsonText,
  sha256,
  syncDirectory,
} from "./lifecycle-core.mjs";

const RECEIPT_SCHEMA_VERSION = "1.0.0";
const RECEIPT_KIND = "ai-task-projection";
const AI_TASK_DIRECTORY_NAME = "AI任务";
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const VERSION_ID = /^ver_\d{4,}$/u;
const CANDIDATE_ID = /^candidate_[A-Za-z0-9_-]{8,160}$/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_ALLOCATION_ATTEMPTS = 10_000;
const RECEIPT_STAGES = new Set([
  "receipt-prepared",
  "directory-allocated",
  "prompt-written",
  "candidate-written",
  "completed",
]);

export class AiTaskProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AiTaskProjectionError";
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedPath(value) {
  return path.resolve(String(value || "")).normalize("NFC");
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

function assertIdentity(value, pattern, label) {
  const normalized = String(value || "");
  if (!pattern.test(normalized)) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_IDENTITY_INVALID",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function assertDigest(value, label, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_HASH_INVALID",
      `${label} is invalid.`,
    );
  }
  return value;
}

function assertRelativeTaskPath(value) {
  const relative = String(value || "").replaceAll("\\", "/");
  if (
    !relative.startsWith(`${AI_TASK_DIRECTORY_NAME}/`)
    || relative.includes("\0")
    || path.posix.isAbsolute(relative)
    || relative.split("/").some((part) => !part || part === "." || part === "..")
    || relative.split("/").length !== 2
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_RECEIPT_INVALID",
      "The AI task projection receipt path is invalid.",
    );
  }
  return relative;
}

function assertCandidateFileName(value) {
  const name = String(value || "").normalize("NFC");
  if (
    !name
    || name === "."
    || name === ".."
    || name.includes("\0")
    || name.includes("/")
    || name.includes("\\")
    || !/\.html?$/iu.test(name)
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_FILE_NAME_INVALID",
      "The AI task Candidate filename is invalid.",
    );
  }
  return name;
}

function assertProjectRelativePath(projectRootPath, relativePath, label) {
  const root = normalizedPath(projectRootPath);
  const relative = String(relativePath || "").replaceAll("\\", "/");
  if (
    !relative
    || path.posix.isAbsolute(relative)
    || relative.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_INVALID",
      `${label} is invalid.`,
    );
  }
  const resolved = path.resolve(root, ...relative.split("/"));
  if (!pathInside(root, resolved)) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_ESCAPE",
      `${label} escapes its project.`,
    );
  }
  return resolved;
}

async function inspectInsideProject(projectRootPath, candidatePath, label) {
  const root = normalizedPath(projectRootPath);
  const target = normalizedPath(candidatePath);
  if (!pathInside(root, target, { allowRoot: true })) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_ESCAPE",
      `${label} escapes its project.`,
    );
  }
  let rootInformation;
  try {
    rootInformation = await lstat(root);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_PROJECT_MISSING",
        "The project root is unavailable.",
      );
    }
    throw cause;
  }
  if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_UNSAFE_DIRECTORY",
      "The project root must be a real directory.",
    );
  }
  const realRoot = await realpath(root);
  const relative = path.relative(root, target);
  const parts = relative === "" ? [] : relative.split(path.sep);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_ESCAPE",
      `${label} escapes its project.`,
    );
  }
  let current = root;
  let information = rootInformation;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      information = await lstat(current);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        return {
          exists: false,
          missingPath: current,
          root,
          realRoot,
        };
      }
      throw cause;
    }
    if (information.isSymbolicLink()) {
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_PATH_ESCAPE",
        `${label} reaches a symbolic link inside its project.`,
      );
    }
    if (current !== target && !information.isDirectory()) {
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_UNSAFE_DIRECTORY",
        `${label} has a non-directory parent.`,
      );
    }
    const realCurrent = await realpath(current);
    if (!pathInside(realRoot, realCurrent, { allowRoot: true })) {
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_PATH_ESCAPE",
        `${label} escapes its project through an unsafe path.`,
      );
    }
  }
  return { exists: true, information, root, realRoot };
}

async function ensureDirectoryInsideProject(projectRootPath, directoryPath, label) {
  const root = normalizedPath(projectRootPath);
  const target = normalizedPath(directoryPath);
  if (!pathInside(root, target, { allowRoot: true })) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_ESCAPE",
      `${label} escapes its project.`,
    );
  }
  const relative = path.relative(root, target);
  const parts = relative === "" ? [] : relative.split(path.sep);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_ESCAPE",
      `${label} escapes its project.`,
    );
  }
  await inspectInsideProject(root, root, "project root");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const inspected = await inspectInsideProject(root, current, label);
    if (!inspected.exists) {
      try {
        await mkdir(current, { mode: 0o755 });
      } catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
      }
    }
    const verified = await inspectInsideProject(root, current, label);
    if (!verified.exists || !verified.information.isDirectory()) {
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_UNSAFE_DIRECTORY",
        `${label} must be a real directory.`,
      );
    }
  }
  return target;
}

async function regularFileInsideProject(projectRootPath, filePath, label) {
  const inspected = await inspectInsideProject(projectRootPath, filePath, label);
  if (!inspected.exists) return null;
  if (!inspected.information.isFile()) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_UNSAFE_FILE",
      `${label} must be a regular file.`,
    );
  }
  return inspected.information;
}

async function readRegularFile(projectRootPath, filePath, label) {
  const information = await regularFileInsideProject(projectRootPath, filePath, label);
  if (!information) return null;
  const buffer = await readFile(filePath);
  const verified = await regularFileInsideProject(projectRootPath, filePath, label);
  if (!verified) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_FILE_CHANGED",
      `${label} disappeared while being read.`,
    );
  }
  return { buffer, sha256: sha256(buffer), information: verified };
}

async function writeFileNoReplace(projectRootPath, filePath, buffer, expectedSha256, label) {
  const expected = assertDigest(expectedSha256, `${label} hash`);
  const parent = path.dirname(filePath);
  await ensureDirectoryInsideProject(projectRootPath, parent, `${label} parent`);
  const existing = await readRegularFile(projectRootPath, filePath, label);
  if (existing) {
    if (existing.sha256 !== expected) {
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_FILE_COLLISION",
        `${label} already exists with different bytes.`,
        { filePath, expectedSha256: expected, actualSha256: existing.sha256 },
      );
    }
    return { created: false };
  }
  let handle;
  try {
    handle = await open(filePath, "wx", 0o644);
    await handle.writeFile(buffer);
    await handle.sync();
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      const raced = await readRegularFile(projectRootPath, filePath, label);
      if (raced?.sha256 === expected) return { created: false };
      throw new AiTaskProjectionError(
        "AI_TASK_PROJECTION_FILE_COLLISION",
        `${label} appeared while being published.`,
        { filePath, expectedSha256: expected, actualSha256: raced?.sha256 || null },
      );
    }
    throw cause;
  } finally {
    await handle?.close();
  }
  const verified = await readRegularFile(projectRootPath, filePath, label);
  if (!verified || verified.sha256 !== expected) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_FILE_COLLISION",
      `${label} was replaced while being published.`,
      { filePath, expectedSha256: expected, actualSha256: verified?.sha256 || null },
    );
  }
  await syncDirectory(parent);
  return { created: true };
}

function taskFolderBase(createdAt, proposedVersionOrdinal) {
  const date = String(createdAt || "");
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(date) || Number.isNaN(Date.parse(date))) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_DATE_INVALID",
      "The frozen Request creation time is invalid.",
    );
  }
  if (!Number.isSafeInteger(Number(proposedVersionOrdinal)) || Number(proposedVersionOrdinal) < 2) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_VERSION_INVALID",
      "The proposed Candidate Version ordinal is invalid.",
    );
  }
  return `${date.slice(0, 10)}-候选版本${Number(proposedVersionOrdinal)}`;
}

function receiptPathFor(recoveryRootPath, requestId, attemptId) {
  return path.join(recoveryRootPath, `${requestId}.${attemptId}.json`);
}

function receiptMatchesIdentity(receipt, expected) {
  return (
    isRecord(receipt)
    && receipt.schemaVersion === RECEIPT_SCHEMA_VERSION
    && receipt.kind === RECEIPT_KIND
    && receipt.projectId === expected.projectId
    && receipt.documentId === expected.documentId
    && receipt.requestId === expected.requestId
    && receipt.attemptId === expected.attemptId
    && receipt.candidateId === expected.candidateId
    && receipt.proposedVersionId === expected.proposedVersionId
    && Number(receipt.proposedVersionOrdinal) === expected.proposedVersionOrdinal
    && receipt.promptSha256 === expected.promptSha256
    && typeof receipt.candidateFileName === "string"
    && receipt.createdAt === expected.createdAt
    && typeof receipt.updatedAt === "string"
    && !Number.isNaN(Date.parse(receipt.updatedAt))
    && RECEIPT_STAGES.has(receipt.stage)
  );
}

function assertReceipt(receipt, expected) {
  if (!receiptMatchesIdentity(receipt, expected)) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_RECEIPT_INVALID",
      "The AI task projection receipt does not match the verified Request.",
    );
  }
  // The candidate filename is a Finder-only display detail. A controlled
  // same-root Working Copy rename may legitimately change its stem after this
  // receipt publishes PROMPT.md, so the next materialization re-derives and
  // rewrites that name instead of invalidating the hidden Candidate authority.
  assertCandidateFileName(receipt.candidateFileName);
  const taskRelativePath = assertRelativeTaskPath(receipt.taskRelativePath);
  const taskName = taskRelativePath.slice(`${AI_TASK_DIRECTORY_NAME}/`.length);
  if (
    taskName !== expected.taskFolderBase
    && !(
      taskName.startsWith(`${expected.taskFolderBase}-`)
      && /^\d+$/u.test(taskName.slice(expected.taskFolderBase.length + 1))
    )
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_RECEIPT_INVALID",
      "The AI task projection receipt has an unexpected task folder name.",
    );
  }
  assertDigest(receipt.candidateSha256, "receipt Candidate hash", { allowNull: true });
  if (
    expected.candidateSha256 !== null
    && receipt.candidateSha256 !== null
    && receipt.candidateSha256 !== expected.candidateSha256
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_RECEIPT_INVALID",
      "The AI task projection receipt points to a different Candidate.",
    );
  }
  return receipt;
}

async function readReceipt(projectRootPath, filePath, expected) {
  const existing = await readRegularFile(projectRootPath, filePath, "AI task projection receipt");
  if (!existing) return null;
  if (existing.buffer.byteLength > MAX_RECEIPT_BYTES) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_RECEIPT_INVALID",
      "The AI task projection receipt is too large.",
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(existing.buffer.toString("utf8"));
  } catch {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_RECEIPT_INVALID",
      "The AI task projection receipt is not valid JSON.",
    );
  }
  return assertReceipt(receipt, expected);
}

async function writeReceipt(projectRootPath, filePath, receipt) {
  await ensureDirectoryInsideProject(
    projectRootPath,
    path.dirname(filePath),
    "AI task projection recovery directory",
  );
  await atomicWriteFile(filePath, Buffer.from(jsonText(receipt), "utf8"), {
    mode: 0o600,
  });
  await regularFileInsideProject(projectRootPath, filePath, "AI task projection receipt");
}

async function directoryState({
  projectRootPath,
  directoryPath,
  promptSha256,
  candidateFileName,
  candidateSha256,
}) {
  const inspected = await inspectInsideProject(
    projectRootPath,
    directoryPath,
    "AI task projection directory",
  ).catch((cause) => {
    if (
      cause instanceof AiTaskProjectionError
      && [
        "AI_TASK_PROJECTION_PATH_ESCAPE",
        "AI_TASK_PROJECTION_UNSAFE_DIRECTORY",
      ].includes(cause.code)
    ) return { unsafe: cause };
    throw cause;
  });
  if (inspected?.unsafe) return { kind: "conflict", reason: inspected.unsafe.code };
  if (!inspected.exists) return { kind: "missing" };
  if (!inspected.information.isDirectory()) return { kind: "conflict", reason: "not-directory" };
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return { kind: "missing" };
    throw cause;
  }
  const allowed = new Set(["PROMPT.md", ".DS_Store"]);
  if (candidateSha256 !== null) allowed.add(candidateFileName);
  if (entries.some((entry) => !allowed.has(entry.name))) {
    return { kind: "conflict", reason: "unexpected-entry" };
  }
  const promptPath = path.join(directoryPath, "PROMPT.md");
  const prompt = await readRegularFile(projectRootPath, promptPath, "AI task PROMPT.md")
    .catch((cause) => cause instanceof AiTaskProjectionError
      ? { conflict: cause.code }
      : Promise.reject(cause));
  if (prompt?.conflict || (prompt && prompt.sha256 !== promptSha256)) {
    return { kind: "conflict", reason: prompt?.conflict || "prompt-mismatch" };
  }
  const candidatePath = path.join(directoryPath, candidateFileName);
  const candidate = await readRegularFile(
    projectRootPath,
    candidatePath,
    "AI task Candidate HTML",
  ).catch((cause) => cause instanceof AiTaskProjectionError
    ? { conflict: cause.code }
    : Promise.reject(cause));
  if (candidate?.conflict) return { kind: "conflict", reason: candidate.conflict };
  if (candidateSha256 === null) {
    if (candidate) return { kind: "conflict", reason: "unexpected-candidate" };
  } else if (candidate && candidate.sha256 !== candidateSha256) {
    return { kind: "conflict", reason: "candidate-mismatch" };
  }
  return { kind: "rebuildable" };
}

async function allocateFreshTaskRelativePath(projectRootPath, baseName) {
  for (let ordinal = 1; ordinal <= MAX_ALLOCATION_ATTEMPTS; ordinal += 1) {
    const name = ordinal === 1 ? baseName : `${baseName}-${ordinal}`;
    const relative = `${AI_TASK_DIRECTORY_NAME}/${name}`;
    const directoryPath = assertProjectRelativePath(
      projectRootPath,
      relative,
      "AI task projection directory",
    );
    const state = await directoryState({
      projectRootPath,
      directoryPath,
      promptSha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      candidateFileName: "projection.html",
      candidateSha256: null,
    });
    if (state.kind === "missing") return relative;
  }
  throw new AiTaskProjectionError(
    "AI_TASK_PROJECTION_PATH_EXHAUSTED",
    "No collision-free AI task projection directory is available.",
  );
}

function nextReceipt(expected, taskRelativePath, stage, current = null) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    projectId: expected.projectId,
    documentId: expected.documentId,
    requestId: expected.requestId,
    attemptId: expected.attemptId,
    candidateId: expected.candidateId,
    proposedVersionId: expected.proposedVersionId,
    proposedVersionOrdinal: expected.proposedVersionOrdinal,
    promptSha256: expected.promptSha256,
    candidateSha256: expected.candidateSha256,
    taskRelativePath,
    candidateFileName: expected.candidateFileName,
    stage,
    createdAt: current?.createdAt || expected.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

async function hit(onStage, stage, details) {
  if (typeof onStage === "function") await onStage(stage, details);
}

export async function materializeAiTaskProjection({
  projectRootPath,
  recoveryRootPath,
  projectId,
  documentId,
  requestId,
  attemptId,
  candidateId,
  proposedVersionId,
  proposedVersionOrdinal,
  createdAt,
  promptBuffer,
  promptSha256,
  candidateBuffer = null,
  candidateSha256 = null,
  candidateFileName,
  onStage = null,
} = {}) {
  const root = normalizedPath(projectRootPath);
  const recoveryRoot = normalizedPath(recoveryRootPath);
  if (!pathInside(root, recoveryRoot)) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PATH_ESCAPE",
      "The AI task projection recovery directory escapes its project.",
    );
  }
  const expected = {
    projectId: assertIdentity(projectId, PROJECT_ID, "projectId"),
    documentId: assertIdentity(documentId, DOCUMENT_ID, "documentId"),
    requestId: assertIdentity(requestId, SAFE_REQUEST_ID, "requestId"),
    attemptId: assertIdentity(attemptId, SAFE_REQUEST_ID, "attemptId"),
    candidateId: assertIdentity(candidateId, CANDIDATE_ID, "candidateId"),
    proposedVersionId: assertIdentity(proposedVersionId, VERSION_ID, "proposedVersionId"),
    proposedVersionOrdinal: Number(proposedVersionOrdinal),
    createdAt: String(createdAt || ""),
    promptSha256: assertDigest(promptSha256, "Prompt hash"),
    candidateSha256: assertDigest(candidateSha256, "Candidate hash", { allowNull: true }),
    candidateFileName: assertCandidateFileName(candidateFileName),
  };
  if (!Buffer.isBuffer(promptBuffer) || sha256(promptBuffer) !== expected.promptSha256) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_PROMPT_MISMATCH",
      "The verified frozen Prompt bytes do not match their hash.",
    );
  }
  if (
    expected.candidateSha256 === null
    ? candidateBuffer !== null
    : !Buffer.isBuffer(candidateBuffer) || sha256(candidateBuffer) !== expected.candidateSha256
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_CANDIDATE_MISMATCH",
      "The verified Candidate bytes do not match their hash.",
    );
  }

  const baseName = taskFolderBase(expected.createdAt, expected.proposedVersionOrdinal);
  if (
    expected.proposedVersionId
      !== `ver_${String(expected.proposedVersionOrdinal).padStart(4, "0")}`
  ) {
    throw new AiTaskProjectionError(
      "AI_TASK_PROJECTION_VERSION_INVALID",
      "The proposed Candidate Version identity is inconsistent.",
    );
  }
  expected.taskFolderBase = baseName;
  const receiptPath = receiptPathFor(
    recoveryRoot,
    expected.requestId,
    expected.attemptId,
  );
  let receipt = await readReceipt(root, receiptPath, expected);
  let taskRelativePath = receipt?.taskRelativePath || await allocateFreshTaskRelativePath(root, baseName);

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const taskDirectoryPath = assertProjectRelativePath(
      root,
      taskRelativePath,
      "AI task projection directory",
    );
    const state = await directoryState({
      projectRootPath: root,
      directoryPath: taskDirectoryPath,
      promptSha256: expected.promptSha256,
      candidateFileName: expected.candidateFileName,
      candidateSha256: expected.candidateSha256,
    });
    if (state.kind === "conflict") {
      taskRelativePath = await allocateFreshTaskRelativePath(root, baseName);
      receipt = nextReceipt(expected, taskRelativePath, "receipt-prepared", receipt);
      await writeReceipt(root, receiptPath, receipt);
      await hit(onStage, "ai-task-projection-receipt-written", {
        receiptPath,
        taskRelativePath,
        collision: state.reason,
      });
      continue;
    }

    const needsReceipt = !receipt
      || receipt.taskRelativePath !== taskRelativePath
      || receipt.candidateFileName !== expected.candidateFileName
      || receipt.candidateSha256 !== expected.candidateSha256
      || receipt.stage === "completed" && state.kind !== "rebuildable";
    if (needsReceipt) {
      receipt = nextReceipt(expected, taskRelativePath, "receipt-prepared", receipt);
      await writeReceipt(root, receiptPath, receipt);
      await hit(onStage, "ai-task-projection-receipt-written", {
        receiptPath,
        taskRelativePath,
      });
    }

    try {
      await ensureDirectoryInsideProject(root, taskDirectoryPath, "AI task projection directory");
    } catch (cause) {
      if (
        !(cause instanceof AiTaskProjectionError)
        || ![
          "AI_TASK_PROJECTION_PATH_ESCAPE",
          "AI_TASK_PROJECTION_UNSAFE_DIRECTORY",
        ].includes(cause.code)
      ) throw cause;
      taskRelativePath = await allocateFreshTaskRelativePath(root, baseName);
      receipt = nextReceipt(expected, taskRelativePath, "receipt-prepared", receipt);
      await writeReceipt(root, receiptPath, receipt);
      await hit(onStage, "ai-task-projection-receipt-written", {
        receiptPath,
        taskRelativePath,
        collision: cause.code,
      });
      continue;
    }
    receipt = nextReceipt(expected, taskRelativePath, "directory-allocated", receipt);
    await writeReceipt(root, receiptPath, receipt);
    await hit(onStage, "ai-task-projection-directory-allocated", {
      receiptPath,
      taskRelativePath,
      taskDirectoryPath,
    });

    try {
      await writeFileNoReplace(
        root,
        path.join(taskDirectoryPath, "PROMPT.md"),
        promptBuffer,
        expected.promptSha256,
        "AI task PROMPT.md",
      );
    } catch (cause) {
      if (!(cause instanceof AiTaskProjectionError) || cause.code !== "AI_TASK_PROJECTION_FILE_COLLISION") {
        throw cause;
      }
      taskRelativePath = await allocateFreshTaskRelativePath(root, baseName);
      receipt = nextReceipt(expected, taskRelativePath, "receipt-prepared", receipt);
      await writeReceipt(root, receiptPath, receipt);
      await hit(onStage, "ai-task-projection-receipt-written", {
        receiptPath,
        taskRelativePath,
        collision: cause.code,
      });
      continue;
    }
    receipt = nextReceipt(expected, taskRelativePath, "prompt-written", receipt);
    await writeReceipt(root, receiptPath, receipt);
    await hit(onStage, "ai-task-projection-prompt-written", {
      receiptPath,
      taskRelativePath,
      promptPath: path.join(taskDirectoryPath, "PROMPT.md"),
    });

    let candidatePath = null;
    if (expected.candidateSha256 !== null) {
      candidatePath = path.join(taskDirectoryPath, expected.candidateFileName);
      try {
        await writeFileNoReplace(
          root,
          candidatePath,
          candidateBuffer,
          expected.candidateSha256,
          "AI task Candidate HTML",
        );
      } catch (cause) {
        if (!(cause instanceof AiTaskProjectionError) || cause.code !== "AI_TASK_PROJECTION_FILE_COLLISION") {
          throw cause;
        }
        taskRelativePath = await allocateFreshTaskRelativePath(root, baseName);
        receipt = nextReceipt(expected, taskRelativePath, "receipt-prepared", receipt);
        await writeReceipt(root, receiptPath, receipt);
        await hit(onStage, "ai-task-projection-receipt-written", {
          receiptPath,
          taskRelativePath,
          collision: cause.code,
        });
        continue;
      }
      receipt = nextReceipt(expected, taskRelativePath, "candidate-written", receipt);
      await writeReceipt(root, receiptPath, receipt);
      await hit(onStage, "ai-task-projection-candidate-written", {
        receiptPath,
        taskRelativePath,
        candidatePath,
      });
    }

    receipt = nextReceipt(expected, taskRelativePath, "completed", receipt);
    await writeReceipt(root, receiptPath, receipt);
    await hit(onStage, "ai-task-projection-completed", {
      receiptPath,
      taskRelativePath,
      taskDirectoryPath,
      candidatePath,
    });
    await hit(onStage, "ai-task-projection-finder-returning", {
      receiptPath,
      taskRelativePath,
      taskDirectoryPath,
      candidatePath,
    });
    return {
      projectId: expected.projectId,
      documentId: expected.documentId,
      requestId: expected.requestId,
      attemptId: expected.attemptId,
      candidateId: expected.candidateId,
      projectRootPath: root,
      taskRelativePath,
      taskPath: taskDirectoryPath,
      promptPath: path.join(taskDirectoryPath, "PROMPT.md"),
      candidatePath,
      candidateSha256: expected.candidateSha256,
      receiptPath,
      stage: "completed",
    };
  }
  throw new AiTaskProjectionError(
    "AI_TASK_PROJECTION_PATH_EXHAUSTED",
    "No collision-free AI task projection directory is available.",
  );
}
