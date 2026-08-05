import {
  buildSourceIndex,
  instrumentPreviewHtml,
  resolveTargetRef,
} from "./source-patch-core.js";
import { sourceTargetRefForSelection } from "./canvas-target-rebind.js";

export const REVIEW_SOURCE_NODE_ATTRIBUTE = "data-pageroot-review-source-node-id";

export function prepareReviewCommentSourceProjection(sourceHtml, enabled = true) {
  const fallback = {
    html: sourceHtml,
    sourceIndex: null,
    projected: false,
  };
  if (!enabled) return fallback;

  let sourceIndex;
  try {
    sourceIndex = buildSourceIndex(sourceHtml);
  } catch {
    return fallback;
  }

  try {
    return {
      html: instrumentPreviewHtml(sourceIndex, {
        attributeName: REVIEW_SOURCE_NODE_ATTRIBUTE,
      }).html,
      sourceIndex,
      projected: true,
    };
  } catch {
    return {
      ...fallback,
      sourceIndex,
    };
  }
}

export function resolveReviewCommentSourceElement(sourceIndex, target) {
  try {
    const resolved = resolveTargetRef(
      sourceIndex,
      sourceTargetRefForSelection(target),
    );
    if (
      !resolved.target
      || resolved.resolution === "ambiguous"
      || resolved.resolution === "orphaned"
    ) return null;
    const sourceElement = resolved.target.type === "element"
      ? resolved.target
      : resolved.target.parentId
        ? sourceIndex.byNodeId.get(resolved.target.parentId)
        : null;
    return sourceElement?.type === "element" ? sourceElement : null;
  } catch {
    return null;
  }
}
