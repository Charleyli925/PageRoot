/**
 * Project the existing Workbench facts into the one context lane the shell
 * renders. This is deliberately a pure presentation rule: it owns no state and
 * never reads from a second store.
 */
export function deriveWorkbenchInspector({
  canvasMode = "edit",
  aiVisible = false,
  reviewVisible = false,
  commentsAvailable = false,
} = {}) {
  if (reviewVisible) return "review";
  if (aiVisible) return "ai";
  if (canvasMode === "edit" && commentsAvailable) return "comments";
  return "none";
}
