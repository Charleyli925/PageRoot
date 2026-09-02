export const DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID = null;

/** Keep visual focus independent from change navigation and return stable state. */
export function nextActiveReviewFocusGroupId(current, value) {
  const next = typeof value === "string" && value.trim() ? value : null;
  return current === next ? current : next;
}
