export const REVIEW_STYLE_ID = "pageroot-ai-review-style";
export const REVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-ai-review-bootstrap";
export const REVIEW_BASE_ATTRIBUTE = "data-pageroot-ai-review-base";
export const REVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";
export const REVIEW_PROJECTION_FACTS_ATTRIBUTE = "data-pageroot-review-projection-facts";
export const REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT = 24;

export const NON_CONTENT_TAGS = new Set([
  "BASE",
  "LINK",
  "META",
  "NOSCRIPT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
]);

export const REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES = [
  "class",
  "height",
  "hidden",
  "style",
  "width",
];

export const REVIEW_COMMENT_KEY_ATTRIBUTE = "data-pageroot-review-comment-key";
export const REVIEW_COMMENT_GLOBAL_ATTRIBUTE = "data-pageroot-review-comment-global";
export const REVIEW_COMMENT_MARKUP_ATTRIBUTE_PATTERN =
  /\sdata-pageroot-review-comment-(?:key|global)="[^"]*"/gu;
