import {
  buildSourceIndex,
  resolveTargetRef,
} from "./source-patch-core.js";
import { sourceTargetRefForSelection } from "./canvas-target-rebind.js";

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

  return {
    html: sourceHtml,
    sourceIndex,
    projected: Boolean(
      sourceIndex.pagerootIdentity?.complete && sourceIndex.pagerootIdentity?.valid,
    ),
  };
}

export function resolveReviewCommentSourceElement(sourceIndex, target) {
  try {
    const resolved = resolveTargetRef(
      sourceIndex,
      sourceTargetRefForSelection(target),
      { surface: "review" },
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
