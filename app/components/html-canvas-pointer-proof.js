export const CANVAS_POINTER_CAPABILITY_KINDS = Object.freeze([
  "edit-text",
  "select-comment",
  "comment-ai",
]);

export const CANVAS_POINTER_CAPABILITIES = Object.freeze({
  "edit-text": Object.freeze({
    kind: "edit-text",
    hint: "双击编辑",
    spoken: "可编辑",
    cursor: "text",
  }),
  "select-comment": Object.freeze({
    kind: "select-comment",
    hint: "单击选择并评论",
    spoken: "仅可评论",
    cursor: "pointer",
  }),
  "comment-ai": Object.freeze({
    kind: "comment-ai",
    hint: "可添加评论交给 AI",
    spoken: "仅可评论",
    cursor: "help",
  }),
});

export function canvasPointerCapabilityFromProof({
  canStartTextEdit,
  sourceResolution,
} = {}) {
  if (canStartTextEdit) return CANVAS_POINTER_CAPABILITIES["edit-text"];
  if (sourceResolution === "exact" || sourceResolution === "rebound") {
    return CANVAS_POINTER_CAPABILITIES["select-comment"];
  }
  return CANVAS_POINTER_CAPABILITIES["comment-ai"];
}
