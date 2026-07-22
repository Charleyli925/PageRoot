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
