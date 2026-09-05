import { recordEditPipelineCount } from "../lib/edit-pipeline-counters.js";
import { createInsertionPointTargetRef, resolveTargetRef } from "../lib/source-patch-core.js";
import { sourceTargetRefForSelection } from "../lib/canvas-target-rebind.js";
import {
  uniqueStructuralInsertionPoints,
} from "./html-canvas-insertion-layout.js";
import type { PageTabAssociation } from "../lib/page-presentation-dom";
import type {
  HtmlCanvasCommentedTarget,
  HtmlCanvasCommentLayoutTarget,
  HtmlCanvasCommentLayoutState,
  HtmlCanvasSelection,
  HtmlCanvasTargetResolution,
} from "./HtmlCanvasEditor.types";
import { selectorForElement } from "./html-canvas-dom";
import type { HtmlCanvasCommentMarker } from "./html-canvas-selection-chrome";
import type { SourceIndexValue } from "./html-canvas-internal-types";
import {
  uniqueSourceElement,
  sourceElementId,
} from "./html-canvas-source-element";
import {
  isRenderedCommentTarget,
  tabAssociationForElement,
} from "./html-canvas-page-view";
import { runtimeVisualTargetForHint } from "./html-canvas-runtime-target";
import {
  defaultGlobalCommentElement,
  inferSelectionLevel,
  isPageRootElement,
  isPageRootSelection,
  readableLabel,
  selectionForElement,
} from "./html-canvas-selection";

export type InsertionPoint = {
  selection: HtmlCanvasSelection;
  kind: "page-start" | "boundary";
};

export type { InsertionLayoutAuthority } from "./html-canvas-insertion-layout.js";
export { insertionLayoutNeedsRefresh } from "./html-canvas-insertion-layout.js";

export type CommentTargetLayout = HtmlCanvasCommentLayoutState["targets"][number];

function separateCommentMarkers(
  markers: HtmlCanvasCommentMarker[],
  containerWidth: number,
  containerHeight: number,
): HtmlCanvasCommentMarker[] {
  const minLeft = 18;
  const maxLeft = Math.max(minLeft, containerWidth - 18);
  const minTop = 18;
  const maxTop = Math.max(minTop, containerHeight - 18);
  const separation = 34;
  const placed: HtmlCanvasCommentMarker[] = [];
  return markers.map((marker) => {
    const candidateOffsets = [[0, 0]];
    for (let distance = separation; distance <= separation * 6; distance += separation) {
      candidateOffsets.push(
        [0, -distance],
        [0, distance],
        [-distance, 0],
        [distance, 0],
      );
    }
    const position = candidateOffsets
      .map(([offsetLeft, offsetTop]) => ({
        left: Math.max(minLeft, Math.min(maxLeft, marker.left + offsetLeft)),
        top: Math.max(minTop, Math.min(maxTop, marker.top + offsetTop)),
      }))
      .find(({ left, top }) => placed.every((existing) => (
        Math.abs(existing.left - left) >= separation
        || Math.abs(existing.top - top) >= separation
      )));
    const next = position ? { ...marker, ...position } : marker;
    placed.push(next);
    return next;
  });
}

function querySourceElement(
  documentNode: Document,
  elementId: string | null | undefined,
): HTMLElement | null {
  return elementId ? uniqueSourceElement(documentNode, elementId) : null;
}

export function measureCommentTargetLayouts(options: {
  documentNode: Document;
  layoutTargets: readonly HtmlCanvasCommentLayoutTarget[];
  sourceIndex: SourceIndexValue | null;
  scrollTop: number;
  commentTabAssociations: readonly PageTabAssociation[];
  isProvenSourceElement?: ((element: HTMLElement) => boolean) | null;
}): CommentTargetLayout[] {
  const {
    documentNode,
    layoutTargets,
    sourceIndex,
    scrollTop,
    commentTabAssociations,
    isProvenSourceElement,
  } = options;
  return layoutTargets.map((entry) => {
    const target = entry.target;
    const missing = (resolution: HtmlCanvasTargetResolution) => ({
      targetId: target.id,
      status: "missing" as const,
      resolution,
    });
    try {
      let targetElement: HTMLElement | null = null;
      let targetResolution: HtmlCanvasTargetResolution = target.resolution;
      if (isPageRootSelection(target)) {
        targetElement = defaultGlobalCommentElement(documentNode);
        targetResolution = "exact";
      } else {
        const resolution = sourceIndex
          ? resolveTargetRef(
            sourceIndex,
            sourceTargetRefForSelection(target),
            { surface: "comments" },
          )
          : null;
        targetResolution = (
          resolution?.resolution ?? "orphaned"
        ) as HtmlCanvasTargetResolution;
        if (resolution?.target?.type !== "element") return missing(targetResolution);
        targetElement = querySourceElement(documentNode, resolution.target.pagerootId);
      }
      if (!targetElement) return missing(targetResolution);
      const visualElement = entry.visualHint
        ? runtimeVisualTargetForHint(targetElement, entry.visualHint, {
            isProvenSourceElement,
          }) ?? targetElement
        : targetElement;
      const measuredElement = isRenderedCommentTarget(visualElement)
        ? visualElement
        : targetElement;
      const targetRect = measuredElement.getBoundingClientRect();
      const visible = isRenderedCommentTarget(measuredElement);
      const tabAssociation = tabAssociationForElement(
        targetElement,
        commentTabAssociations,
      );
      if (!visible) {
        return tabAssociation
          ? {
              targetId: target.id,
              status: "hidden" as const,
              resolution: targetResolution,
              tabGroupKey: tabAssociation.key,
              tabGroupLabel: tabAssociation.label,
            }
          : {
              targetId: target.id,
              status: "hidden" as const,
              resolution: targetResolution,
            };
      }
      const top = targetRect.top + scrollTop;
      if (!Number.isFinite(top) || !Number.isFinite(targetRect.height)) {
        return missing(targetResolution);
      }
      return {
        targetId: target.id,
        status: "visible" as const,
        resolution: targetResolution,
        top: Math.max(0, top),
        height: Math.max(0, targetRect.height),
        ...(tabAssociation
          ? {
              tabGroupKey: tabAssociation.key,
              tabGroupLabel: tabAssociation.label,
            }
          : {}),
      };
    } catch {
      return missing("orphaned");
    }
  });
}

export function layoutInsertionPoints(options: {
  documentNode: Document;
  sourceIndex: SourceIndexValue | null;
}): {
  allInsertionPoints: InsertionPoint[];
} {
  const { documentNode, sourceIndex } = options;
  recordEditPipelineCount("insertionPointFullTreeScan", {
    caller: "layoutInsertionPoints",
  });
  const moduleParents = new Set<HTMLElement>();
  documentNode.body.querySelectorAll<HTMLElement>("*").forEach((candidate) => {
    if (inferSelectionLevel(candidate) === "module" && candidate.parentElement) {
      moduleParents.add(candidate.parentElement);
    }
  });

  const collectedInsertionPoints: InsertionPoint[] = [];
  moduleParents.forEach((parent) => {
    const htmlElement = documentNode.defaultView?.HTMLElement;
    const children = Array.from(parent.children).filter(
      (child): child is HTMLElement => Boolean(htmlElement && child instanceof htmlElement),
    );
    const parentSelector = selectorForElement(parent);
    const parentElementId = sourceElementId(parent);

    const addBoundary = (
      beforeSibling: HTMLElement | null,
      label: string,
    ) => {
      const beforeSiblingElementId = sourceElementId(beforeSibling);
      let insertionTargetRef: ReturnType<typeof createInsertionPointTargetRef> | null = null;
      if (sourceIndex && parentElementId && (!beforeSibling || beforeSiblingElementId)) {
        try {
          insertionTargetRef = createInsertionPointTargetRef(sourceIndex, {
            parentId: parentElementId,
            beforeSiblingId: beforeSiblingElementId,
            label,
          });
        } catch {
          insertionTargetRef = null;
        }
      }
      const fallbackBoundary = beforeSiblingElementId || `end_${parentSelector}`;
      const fallbackTargetId = `target_insertion_${encodeURIComponent(parentSelector)}_${encodeURIComponent(fallbackBoundary)}`;
      collectedInsertionPoints.push({
        kind: "boundary",
        selection: {
          id: insertionTargetRef?.targetId || fallbackTargetId,
          label,
          selector: insertionTargetRef?.selector || parentSelector,
          level: "insertion",
          tagName: "insertion",
          text: "",
          resolution: insertionTargetRef ? "exact" : "orphaned",
          ...(insertionTargetRef?.sourceAnchor
            ? { sourceAnchor: insertionTargetRef.sourceAnchor }
            : {}),
          ...(insertionTargetRef?.fingerprint
            ? { fingerprint: insertionTargetRef.fingerprint }
            : {}),
        },
      });
    };

    children.forEach((moduleElement, childIndex) => {
      if (inferSelectionLevel(moduleElement) !== "module") return;
      const previousElement = children[childIndex - 1] || null;
      const nextElement = children[childIndex + 1] || null;
      const beforeLabel = previousElement && inferSelectionLevel(previousElement) === "module"
        ? `在「${readableLabel(previousElement)}」与「${readableLabel(moduleElement)}」之间`
        : `在「${readableLabel(moduleElement)}」之前`;
      addBoundary(moduleElement, beforeLabel);

      // Consecutive modules share one source boundary: the next module's
      // "before" point is also this module's "after" point.
      if (nextElement && inferSelectionLevel(nextElement) === "module") return;
      addBoundary(nextElement, `在「${readableLabel(moduleElement)}」之后`);
    });
  });

  const allInsertionPoints = uniqueStructuralInsertionPoints(collectedInsertionPoints);
  const pageStartPoint = allInsertionPoints[0];
  if (pageStartPoint) {
    pageStartPoint.kind = "page-start";
    pageStartPoint.selection = {
      ...pageStartPoint.selection,
      label: "在页面顶部添加内容建议",
    };
  }
  return { allInsertionPoints };
}

export function layoutCommentMarkers(options: {
  documentNode: Document;
  commentedTargets: readonly HtmlCanvasCommentedTarget[];
  commentLayoutsByTargetId: ReadonlyMap<string, CommentTargetLayout>;
  commentTabAssociations: readonly PageTabAssociation[];
  sourceIndex: SourceIndexValue | null;
  frameHeight: number;
  frameOffsetLeft: number;
  frameOffsetTop: number;
  containerWidth: number;
  containerHeight: number;
  isProvenSourceElement?: ((element: HTMLElement) => boolean) | null;
}): HtmlCanvasCommentMarker[] {
  const {
    documentNode,
    commentedTargets,
    commentLayoutsByTargetId,
    commentTabAssociations,
    sourceIndex,
    frameHeight,
    frameOffsetLeft,
    frameOffsetTop,
    containerWidth,
    containerHeight,
    isProvenSourceElement,
  } = options;
  const nextCommentMarkers: HtmlCanvasCommentMarker[] = [];
  commentedTargets.forEach((rawTarget, targetIndex) => {
    if (rawTarget.showMarker === false) return;
    const target = rawTarget.target;
    if (commentLayoutsByTargetId.get(target.id)?.status !== "visible") return;
    let targetElement: HTMLElement | null = null;
    try {
      const resolution = sourceIndex
        ? resolveTargetRef(
          sourceIndex,
          sourceTargetRefForSelection(target),
          { surface: "comments" },
        )
        : null;
      if (resolution?.target?.type === "element") {
        targetElement = querySourceElement(documentNode, resolution.target.pagerootId);
      }
    } catch {
      targetElement = null;
    }
    if (!targetElement) return;
    const visualElement = rawTarget.visualHint
      ? runtimeVisualTargetForHint(targetElement, rawTarget.visualHint, {
          isProvenSourceElement,
        }) ?? targetElement
      : targetElement;
    const measuredElement = isRenderedCommentTarget(visualElement)
      ? visualElement
      : targetElement;
    const targetRect = measuredElement.getBoundingClientRect();
    if (targetRect.bottom < 0 || targetRect.top > frameHeight) return;
    const isGlobalPageTarget = isPageRootElement(targetElement)
      && target.level === "module"
      && !rawTarget.visualHint;
    const tabControl = commentTabAssociations.find((association) => (
      association.control === targetElement
      || association.control.contains(targetElement)
    ))?.control ?? null;
    const markerAnchorRect = tabControl?.getBoundingClientRect() ?? targetRect;
    nextCommentMarkers.push({
      key: target.id || `${target.selector}:${targetIndex}`,
      selection: {
        ...selectionForElement(targetElement, sourceIndex, target),
        ...(rawTarget.visualHint ? { visualHint: rawTarget.visualHint } : {}),
      },
      count: rawTarget.count,
      label: rawTarget.label || rawTarget.visualHint?.label,
      placement: tabControl ? "tab-side" : "target-corner",
      left: isGlobalPageTarget
        ? Math.max(18, Math.min(containerWidth - 28, frameOffsetLeft + 18))
        : tabControl
          ? Math.max(
              18,
              Math.min(
                containerWidth - 28,
                frameOffsetLeft + markerAnchorRect.right + 10,
              ),
            )
          : Math.max(
              18,
              Math.min(
                containerWidth - 28,
                frameOffsetLeft + targetRect.right - 12,
              ),
            ),
      top: isGlobalPageTarget
        ? Math.max(18, Math.min(containerHeight - 18, frameOffsetTop + 18))
        : tabControl
          ? Math.max(
              18,
              Math.min(
                containerHeight - 18,
                frameOffsetTop + markerAnchorRect.top - 4,
              ),
            )
          : Math.max(
              18,
              Math.min(
                containerHeight - 18,
                frameOffsetTop + targetRect.top - 10,
              ),
            ),
    });
  });
  return separateCommentMarkers(nextCommentMarkers, containerWidth, containerHeight);
}
