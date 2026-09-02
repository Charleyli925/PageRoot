import { isValidPagerootElementId } from "../../../shared/pageroot-element-identity.mjs";

export function isSavableCommentTarget(target) {
  const anchor = target?.commentAnchor || target;
  const globalPageTarget = String(anchor?.selector || "").trim().toLowerCase() === "body"
    && anchor?.level === "module";
  return anchor?.resolution === "exact"
    && (globalPageTarget || isValidPagerootElementId(anchor?.elementId));
}

export function planCommentCommit({
  disposed = false,
  target = null,
  uploadCount = 0,
  text = "",
  attachmentCount = 0,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "COMMENT_WORKFLOW_DISPOSED",
      reason: "评论工作流已停止。",
    });
  }
  if (!target) {
    return Object.freeze({
      kind: "reject",
      code: "COMMENT_TARGET_MISSING",
      reason: "请先选择要评论的内容。",
    });
  }
  if (!isSavableCommentTarget(target)) {
    return Object.freeze({
      kind: "reject",
      code: "COMMENT_TARGET_UNSAFE",
      reason: "当前内容暂时无法建立安全的评论位置。",
    });
  }
  if (Number(uploadCount) > 0) {
    return Object.freeze({
      kind: "reject",
      code: "ATTACHMENT_UPLOAD_PENDING",
      reason: "请等待附件添加完成后再保存评论。",
    });
  }
  if (!String(text || "").trim() && Number(attachmentCount) <= 0) {
    return Object.freeze({
      kind: "reject",
      code: "COMMENT_EMPTY",
      reason: "请输入评论内容或添加附件。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
