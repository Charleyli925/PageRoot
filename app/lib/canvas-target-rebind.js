import {
  buildSourceIndex,
  createInsertionPointTargetRef,
  createTargetRef,
  resolveTargetRef,
} from "./source-patch-core.js";

export function targetLevelForSelection(level) {
  if (level === "module") return "module";
  if (level === "insertion") return "insertion-point";
  return "subregion";
}

export function sourceTargetRefForSelection(selection) {
  return {
    targetId: selection.id,
    label: selection.label,
    level: targetLevelForSelection(selection.level),
    selector: selection.selector || undefined,
    textQuote: selection.textQuote,
    sourceAnchor: selection.sourceAnchor,
    fingerprint: selection.fingerprint,
    resolution: selection.resolution,
  };
}

export function rebindCanvasSelectionTargets(sourceHtml, targets) {
  let sourceIndex;
  try {
    sourceIndex = buildSourceIndex(sourceHtml);
  } catch {
    return targets.map((target) => ({ ...target, resolution: "orphaned" }));
  }

  return targets.map((target) => {
    try {
      const resolved = resolveTargetRef(
        sourceIndex,
        sourceTargetRefForSelection(target),
      );
      const resolution = resolved.resolution;
      if (
        !resolved.target
        || resolution === "ambiguous"
        || resolution === "orphaned"
      ) {
        return { ...target, resolution };
      }
      if (
        target.level === "insertion"
        && resolved.target.type === "insertion-point"
      ) {
        if (resolution === "exact") return { ...target, resolution };
        const parent = resolved.target.parentId
          ? sourceIndex.byNodeId.get(resolved.target.parentId)
          : null;
        if (!parent || parent.type !== "element") {
          return { ...target, resolution: "orphaned" };
        }
        const beforeSiblingId = parent.childIds.find((nodeId) => (
          sourceIndex.byNodeId.get(nodeId)?.range.startOffset
          === resolved.target.offset
        ));
        const refreshed = createInsertionPointTargetRef(sourceIndex, {
          parentId: parent.nodeId,
          ...(beforeSiblingId ? { beforeSiblingId } : {}),
          targetId: target.id,
          label: target.label,
        });
        return {
          ...target,
          selector: refreshed.selector,
          sourceAnchor: refreshed.sourceAnchor,
          fingerprint: refreshed.fingerprint,
          resolution,
        };
      }
      if (resolved.target.type !== "element") {
        return { ...target, resolution };
      }
      const refreshed = createTargetRef(sourceIndex, resolved.target, {
        targetId: target.id,
        label: target.label,
        level: targetLevelForSelection(target.level),
      });
      return {
        ...target,
        nodeId: resolved.target.nodeId,
        selector: refreshed.selector,
        textQuote: refreshed.textQuote,
        sourceAnchor: refreshed.sourceAnchor,
        fingerprint: refreshed.fingerprint,
        resolution,
      };
    } catch {
      return { ...target, resolution: "orphaned" };
    }
  });
}

function resolvedNodeIdentity(sourceIndex, target) {
  try {
    const resolved = resolveTargetRef(
      sourceIndex,
      sourceTargetRefForSelection(target),
    );
    if (!resolved.target) return null;
    if (resolved.target.type === "insertion-point") {
      return `insertion:${resolved.target.parentId}:${resolved.target.offset}`;
    }
    return `${resolved.target.type}:${resolved.target.nodeId}`;
  } catch {
    return null;
  }
}

function transitionTargetIdentity(target, nextTarget) {
  const transitioned = {
    ...target,
    nodeId: nextTarget.nodeId,
    selector: nextTarget.selector,
    tagName: nextTarget.tagName,
    text: nextTarget.text,
    resolution: nextTarget.resolution,
    textQuote: nextTarget.textQuote,
    sourceAnchor: nextTarget.sourceAnchor,
    fingerprint: nextTarget.fingerprint,
  };
  if (!transitioned.nodeId) delete transitioned.nodeId;
  if (transitioned.textQuote === undefined) delete transitioned.textQuote;
  if (!transitioned.sourceAnchor) delete transitioned.sourceAnchor;
  if (!transitioned.fingerprint) delete transitioned.fingerprint;
  return transitioned;
}

/**
 * Rebinds live comment/audit targets across one exact history operation.
 *
 * A comment and the edit operation can intentionally use different targetIds
 * for the same authored element. Generic post-hoc resolution can lose that
 * element when undo restores its previous text fingerprint. The history
 * operation's before/after target pair provides a deterministic identity
 * bridge for aliases that resolve to the same current source node.
 */
export function rebindCanvasSelectionTargetsAcrossHistory(
  currentSourceHtml,
  nextSourceHtml,
  targets,
  { fromTarget, toTarget } = {},
) {
  if (!fromTarget || !toTarget) {
    return rebindCanvasSelectionTargets(nextSourceHtml, targets);
  }
  let currentIndex;
  try {
    currentIndex = buildSourceIndex(currentSourceHtml);
  } catch {
    return rebindCanvasSelectionTargets(nextSourceHtml, targets);
  }
  const transitionIdentity = resolvedNodeIdentity(currentIndex, fromTarget);
  if (!transitionIdentity) {
    return rebindCanvasSelectionTargets(nextSourceHtml, targets);
  }
  const transitioned = targets.map((target) => (
    resolvedNodeIdentity(currentIndex, target) === transitionIdentity
      ? transitionTargetIdentity(target, toTarget)
      : target
  ));
  return rebindCanvasSelectionTargets(nextSourceHtml, transitioned);
}
