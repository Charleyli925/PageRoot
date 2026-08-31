// Freeze comment attachments into a Request-owned, content-addressed bundle.
// This module deliberately copies bytes read from the Draft into a new regular
// file. The resulting Request never depends on a mutable Draft inode.
import { rm } from "node:fs/promises";
import path from "node:path";

import { syncDirectory } from "../lifecycle-core.mjs";

import {
  MAX_REQUEST_ATTACHMENT_BYTES,
  SAFE_REQUEST_ID,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  assertRealPathInsideProject,
  assertSha256,
  ensureProjectDirectory,
  ensureRelativePath,
  isObject,
  pathInside,
  readRegularFileWithSha256,
  regularInformation,
  resolveRelative,
  sameFileIdentity,
  writeFileNoReplace,
} from "./path-safety.mjs";

const COMMENT_ID = /^comment_[A-Za-z0-9_-]+$/u;
const ATTACHMENT_ID = /^attachment_[A-Za-z0-9_-]+$/u;
const TARGET_ID = /^target_[A-Za-z0-9_-]+$/u;
const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u;
const MAX_FILE_NAME_BYTES = 180;

function attachmentError(code, message, details = {}) {
  return new ProjectFileRepositoryError(code, message, details);
}

function safeAttachmentFileName(value, label) {
  const fileName = String(value ?? "");
  if (
    !fileName
    || fileName === "."
    || fileName === ".."
    || fileName.includes("/")
    || fileName.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(fileName)
    || Buffer.byteLength(fileName, "utf8") > MAX_FILE_NAME_BYTES
  ) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label} is not a safe attachment file name.`,
    );
  }
  return fileName;
}

function targetIdForComment(comment, label) {
  const targetId = String(comment?.target?.id || comment?.target?.targetId || "");
  if (!TARGET_ID.test(targetId)) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label} has no valid target reference.`,
      { targetId },
    );
  }
  return targetId;
}

function normalizeMediaType(value, label) {
  const mediaType = String(value || "").toLowerCase();
  if (!MEDIA_TYPE.test(mediaType)) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}.mediaType is invalid.`,
    );
  }
  return mediaType;
}

function validateAttachmentMetadata(comment, attachment, index) {
  const label = `comments[${index}].attachments`;
  if (!isObject(attachment)) {
    throw attachmentError("REQUEST_ATTACHMENT_INVALID", `${label}[${index}] is invalid.`);
  }
  const commentId = String(comment?.commentId || "");
  if (!COMMENT_ID.test(commentId)) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `comments[${index}].commentId is invalid.`,
      { commentId },
    );
  }
  const attachmentId = String(attachment.attachmentId || "");
  if (!ATTACHMENT_ID.test(attachmentId)) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].attachmentId is invalid.`,
      { attachmentId },
    );
  }
  if (
    attachment.commentId !== undefined
    && String(attachment.commentId) !== commentId
  ) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].commentId does not match its comment.`,
      { commentId, attachmentCommentId: attachment.commentId },
    );
  }
  const fileName = safeAttachmentFileName(
    attachment.fileName,
    `${label}[${index}].fileName`,
  );
  if (
    Buffer.byteLength(`${attachmentId}-${fileName}`, "utf8") > 255
    || Buffer.byteLength(fileName, "utf8") > MAX_FILE_NAME_BYTES
  ) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].fileName is too long for a managed path.`,
    );
  }
  const relativePath = ensureRelativePath(
    attachment.relativePath,
    `${label}[${index}].relativePath`,
  );
  const expectedDraftPath = [
    "draft",
    "attachments",
    commentId,
    `${attachmentId}-${fileName}`,
  ].join("/");
  if (relativePath !== expectedDraftPath) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].relativePath must point to this comment's Draft attachment.`,
      { expectedRelativePath: expectedDraftPath, relativePath },
    );
  }
  if (
    !Number.isSafeInteger(attachment.byteLength)
    || attachment.byteLength < 1
    || attachment.byteLength > MAX_REQUEST_ATTACHMENT_BYTES
  ) {
    throw attachmentError(
      attachment.byteLength > MAX_REQUEST_ATTACHMENT_BYTES
        ? "REQUEST_ATTACHMENT_TOO_LARGE"
        : "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].byteLength is outside the supported range.`,
      { byteLength: attachment.byteLength },
    );
  }
  const expectedSha256 = assertSha256(
    attachment.sha256,
    `${label}[${index}].sha256`,
  );
  const kind = attachment.kind;
  if (kind !== "image" && kind !== "file") {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].kind is invalid.`,
    );
  }
  if (
    attachment.source !== undefined
    && attachment.source !== "clipboard"
    && attachment.source !== "file-picker"
  ) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_INVALID",
      `${label}[${index}].source is invalid.`,
    );
  }
  return {
    commentId,
    attachmentId,
    targetRef: targetIdForComment(comment, `comments[${index}]`),
    kind,
    fileName,
    mediaType: normalizeMediaType(
      attachment.mediaType,
      `${label}[${index}]`,
    ),
    byteLength: attachment.byteLength,
    sha256: expectedSha256,
    relativePath,
    ...(attachment.source ? { sourceKind: attachment.source } : {}),
  };
}

async function readAndValidateSource({ projectRootPath, plan }) {
  const sourcePath = resolveRelative(
    projectRootPath,
    plan.relativePath,
    `Draft attachment ${plan.attachmentId} path`,
  );
  const safety = await assertRealPathInsideProject(
    projectRootPath,
    sourcePath,
    `Draft attachment ${plan.attachmentId}`,
    { allowMissing: false, expectedKind: "file" },
  );
  if (!safety?.exists) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_NOT_FOUND",
      `Draft attachment ${plan.attachmentId} was not found.`,
      { relativePath: plan.relativePath },
    );
  }
  const source = await readRegularFileWithSha256(
    sourcePath,
    `Draft attachment ${plan.attachmentId}`,
    { projectRootPath },
  );
  if (!source) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_NOT_FOUND",
      `Draft attachment ${plan.attachmentId} was not found.`,
      { relativePath: plan.relativePath },
    );
  }
  if (
    source.buffer.byteLength !== plan.byteLength
    || source.buffer.byteLength > MAX_REQUEST_ATTACHMENT_BYTES
  ) {
    throw attachmentError(
      source.buffer.byteLength > MAX_REQUEST_ATTACHMENT_BYTES
        ? "REQUEST_ATTACHMENT_TOO_LARGE"
        : "REQUEST_ATTACHMENT_LENGTH_MISMATCH",
      `Draft attachment ${plan.attachmentId} byteLength does not match its frozen metadata.`,
      {
        expectedByteLength: plan.byteLength,
        actualByteLength: source.buffer.byteLength,
      },
    );
  }
  if (source.sha256 !== plan.sha256) {
    throw attachmentError(
      "REQUEST_ATTACHMENT_HASH_MISMATCH",
      `Draft attachment ${plan.attachmentId} no longer matches its SHA-256 metadata.`,
      { expectedSha256: plan.sha256, actualSha256: source.sha256 },
    );
  }
  return { ...plan, sourcePath, source };
}

async function removeCreatedAttachments(created) {
  for (const item of created.reverse()) {
    await rm(item.destinationPath, { force: true }).catch(() => {});
    await syncDirectory(path.dirname(item.destinationPath)).catch(() => {});
  }
}

/**
 * Validate every comment attachment before creating any Request-owned file,
 * then copy and re-read every byte before the caller publishes request.json or
 * Runtime authority.
 */
export async function freezeRequestCommentAttachments({
  projectRootPath,
  requestRoot,
  publicRequestRoot = requestRoot,
  requestId,
  comments = [],
} = {}) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw attachmentError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  if (!Array.isArray(comments)) {
    throw attachmentError("REQUEST_ATTACHMENT_INVALID", "Request comments must be an array.");
  }

  const plans = [];
  const seenAttachmentIds = new Set();
  for (const [commentIndex, comment] of comments.entries()) {
    if (comment?.attachments === undefined) continue;
    if (!Array.isArray(comment.attachments)) {
      throw attachmentError(
        "REQUEST_ATTACHMENT_INVALID",
        `comments[${commentIndex}].attachments must be an array.`,
      );
    }
    for (const [attachmentIndex, attachment] of comment.attachments.entries()) {
      const plan = validateAttachmentMetadata(
        comment,
        attachment,
        commentIndex,
      );
      if (seenAttachmentIds.has(plan.attachmentId)) {
        throw attachmentError(
          "REQUEST_ATTACHMENT_DUPLICATE",
          `Attachment ${plan.attachmentId} is referenced by more than one comment.`,
          { attachmentId: plan.attachmentId, attachmentIndex },
        );
      }
      seenAttachmentIds.add(plan.attachmentId);
      plans.push({
        ...plan,
        requestRelativePath: [
          "input",
          "attachments",
          plan.commentId,
          `${plan.attachmentId}-${plan.fileName}`,
        ].join("/"),
      });
    }
  }

  // This is intentionally a complete first pass. A malformed, missing or
  // tampered source is rejected before the Request directory is materialized.
  const sources = [];
  for (const plan of plans) {
    sources.push(await readAndValidateSource({ projectRootPath, plan }));
  }

  const created = [];
  try {
    for (const item of sources) {
      const destinationPath = path.join(
        requestRoot,
        ...item.requestRelativePath.split("/"),
      );
      if (!pathInside(requestRoot, destinationPath)) {
        throw attachmentError(
          "PATH_ESCAPES_PROJECT",
          `Frozen attachment ${item.attachmentId} escapes its Request.`,
        );
      }
      await assertRealPathInsideProject(
        projectRootPath,
        destinationPath,
        `Frozen attachment ${item.attachmentId}`,
      );
      await ensureProjectDirectory(
        projectRootPath,
        path.dirname(destinationPath),
        `Frozen attachment ${item.attachmentId} directory`,
      );
      const existing = await regularInformation(
        destinationPath,
        `Frozen attachment ${item.attachmentId}`,
        { projectRootPath },
      );
      if (existing) {
        throw attachmentError(
          "REQUEST_ATTACHMENT_COLLISION",
          `Frozen attachment ${item.attachmentId} already exists.`,
          { destinationPath },
        );
      }
      const published = await writeFileNoReplace(
        destinationPath,
        item.source.buffer,
        item.sha256,
        `Frozen attachment ${item.attachmentId}`,
        { projectRootPath },
      );
      if (!published.created) {
        throw attachmentError(
          "REQUEST_ATTACHMENT_COLLISION",
          `Frozen attachment ${item.attachmentId} already exists.`,
          { destinationPath },
        );
      }
      created.push({ destinationPath });
      const copied = await readRegularFileWithSha256(
        destinationPath,
        `Frozen attachment ${item.attachmentId}`,
        { projectRootPath },
      );
      if (
        !copied
        || copied.buffer.byteLength !== item.byteLength
        || copied.sha256 !== item.sha256
        || sameFileIdentity(item.source.information, copied.information)
      ) {
        throw attachmentError(
          "REQUEST_ATTACHMENT_COPY_MISMATCH",
          `Frozen attachment ${item.attachmentId} did not produce an independent byte-identical copy.`,
          { destinationPath },
        );
      }
    }
  } catch (cause) {
    await removeCreatedAttachments(created);
    throw cause;
  }

  const frozenComments = comments.map((comment) => {
    if (!Array.isArray(comment?.attachments) || comment.attachments.length === 0) {
      return comment;
    }
    return {
      ...comment,
      attachments: comment.attachments.map((attachment) => {
        const frozen = sources.find(
          (item) => item.attachmentId === attachment.attachmentId,
        );
        return {
          attachmentId: frozen.attachmentId,
          kind: frozen.kind,
          fileName: frozen.fileName,
          mediaType: frozen.mediaType,
          byteLength: frozen.byteLength,
          sha256: frozen.sha256,
          relativePath: frozen.relativePath,
          requestRelativePath: frozen.requestRelativePath,
          ...(frozen.sourceKind ? { source: frozen.sourceKind } : {}),
        };
      }),
    };
  });

  const attachments = sources.map((item) => ({
    attachmentId: item.attachmentId,
    commentId: item.commentId,
    targetRef: item.targetRef,
    kind: item.kind,
    fileName: item.fileName,
    mediaType: item.mediaType,
    byteLength: item.byteLength,
    sha256: item.sha256,
    relativePath: `requests/${id}/${item.requestRelativePath}`,
    requestRelativePath: item.requestRelativePath,
    localPath: path.join(publicRequestRoot, ...item.requestRelativePath.split("/")),
    ...(item.sourceKind ? { source: item.sourceKind } : {}),
  }));
  const manifestFiles = sources.map((item) => ({
    path: item.requestRelativePath,
    role: "comment-attachment",
    mediaType: item.mediaType,
    byteLength: item.byteLength,
    sha256: item.sha256,
  }));
  const promptAppendix = sources.length === 0
    ? ""
    : [
      "",
      "## 冻结评论附件",
      "",
      "按 `change-request.json` 中每条 instruction 的 `attachmentRefs` 找到同一 attachmentId，再读取该附件的 `requestRelativePath`。这些文件是本 Request 的不可变副本；不要回读 Draft 路径、用户原始路径或外部文件。",
      "",
      ...sources.map((item) => (
        `- ${item.attachmentId}（${item.commentId}）：${item.requestRelativePath}；${item.mediaType}；${item.byteLength} bytes；${item.sha256}`
      )),
      "",
    ].join("\n");

  return {
    comments: frozenComments,
    attachments,
    manifestFiles,
    promptAppendix,
  };
}

export { MAX_REQUEST_ATTACHMENT_BYTES };
