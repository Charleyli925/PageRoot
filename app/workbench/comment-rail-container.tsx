"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { CommentControllerCapability } from "../application/workspace-controller.js";
import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";
import {
  computeAlignedRailOffset,
  computeCommentRailMinimumOffset,
  layoutCommentRailItems,
  routeCommentRailWheel,
} from "../lib/comment-rail-layout.js";
import {
  commentMarkerGroupKey,
  virtualizedCommentIds,
} from "../lib/comment-virtualization.js";
import {
  commentEditSessionHasChanges,
} from "./comment-model";
import { relinkNoticeCopy } from "./comment-relink-model.js";
import {
  composerViewFields,
  type CommentDraft,
  type CommentRailActions,
  type CommentRailContainerContext,
  type CommentRailHostActions,
  type CommentRailModel,
  type ComposerState,
  type OtherTabCommentGroup,
} from "./comment-rail-contract";
import type { CommentCanvasPort } from "./comment-canvas-port";
import { CommentRailView } from "./comment-rail-view";
import type {
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
  OtherTabCommentEntry,
} from "./types";

export type CommentRailCapability = CommentControllerCapability<
  CommentItem,
  DirectEditEvent,
  CommentAttachment,
  HtmlCanvasSelection,
  CommentEditSession
>;

function liveComposer(
  composer: ComposerState,
  workingCopy: ReturnType<CommentRailCapability["getSnapshot"]>["workingCopy"],
): ComposerState {
  if (!workingCopy || composer.kind === "relinking") return composer;
  if (composer.kind === "editing") {
    const session = workingCopy.editSession;
    if (!session || session.commentId !== composer.commentId) return composer;
    return {
      ...composer,
      draft: {
        ...composer.draft,
        text: session.draftText,
        attachments: session.draftAttachments,
      },
      session,
    };
  }
  const draft = {
    text: workingCopy.composerDraft,
    commentId: workingCopy.composerCommentId,
    attachments: workingCopy.composerAttachments,
    target: workingCopy.composerTarget,
  };
  if (composer.kind === "new") {
    return {
      kind: "new",
      target: workingCopy.composerTarget || composer.target,
      draft,
    };
  }
  if (!composer.collapsedDraft && !workingCopy.composerTarget) return composer;
  return { kind: "closed", collapsedDraft: draft };
}

function commentMeasurementKey(itemKey: string, layoutState: unknown): string {
  const text = JSON.stringify(layoutState);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${itemKey}::${text.length}-${(hash >>> 0).toString(36)}`;
}

function shallowEqualRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  ignored = new Set<string>(),
): boolean {
  const leftKeys = Object.keys(left).filter((key) => !ignored.has(key));
  const rightKeys = Object.keys(right).filter((key) => !ignored.has(key));
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(left[key], right[key]));
}

function sameDraft(left: CommentDraft | null, right: CommentDraft | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.text === right.text
    && left.commentId === right.commentId
    && left.attachments === right.attachments
    && left.target === right.target;
}

function sameComposer(left: ComposerState, right: ComposerState): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === "closed" && right.kind === "closed") {
    return sameDraft(left.collapsedDraft, right.collapsedDraft);
  }
  if (left.kind === "new" && right.kind === "new") {
    return left.target === right.target && sameDraft(left.draft, right.draft);
  }
  if (left.kind === "editing" && right.kind === "editing") {
    return left.commentId === right.commentId
      && left.session === right.session
      && sameDraft(left.draft, right.draft);
  }
  return left.kind === "relinking"
    && right.kind === "relinking"
    && left.commentId === right.commentId;
}

function draftScope(target: HtmlCanvasSelection | null): string {
  if (!target) return "尚未选择";
  if (target.tagName === "body") return "全局评论";
  if (target.level === "module") return "整个模块";
  if (target.level === "insertion") return "添加位置";
  return "页面内容";
}

export const CommentRailContainer = memo(function CommentRailContainer({
  capability,
  canvasPort,
  context,
  actions,
}: {
  capability: CommentRailCapability;
  canvasPort: CommentCanvasPort;
  context: CommentRailContainerContext;
  actions: CommentRailHostActions;
}) {
  const commentsPanelRef = useRef<HTMLElement>(null);
  const commentsHeaderRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const commentEditRef = useRef<HTMLTextAreaElement>(null);
  const handledComposerFocusRevisionRef = useRef(0);
  const commentRailOffsetRef = useRef(0);
  const commentRailMinimumOffsetRef = useRef(0);
  const [commentCardHeights, setCommentCardHeights] = useState<Record<string, number>>({});
  const [commentHeaderHeight, setCommentHeaderHeight] = useState(62);
  const [commentViewport, setCommentViewport] = useState({ top: 0, height: 800 });
  const [commentRailOffset, setCommentRailOffset] = useState(0);
  const [commentRailFollowsFocus, setCommentRailFollowsFocus] = useState(false);
  const [expandedOtherTabCommentsKey, setExpandedOtherTabCommentsKey] = useState("");
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const canvasSnapshot = useSyncExternalStore(
    canvasPort.subscribe,
    canvasPort.getSnapshot,
    canvasPort.getSnapshot,
  );
  const composer = liveComposer(context.composer, snapshot.workingCopy);
  const {
    composerOpen,
    draftTarget,
    draft,
    draftAttachments,
    editingCommentId,
    commentEditSession,
    relinkingTarget,
  } = composerViewFields(composer);
  const attachmentUploadCount = snapshot.persistence?.attachmentUploadCount ?? 0;
  const targetLayouts = canvasSnapshot.targetLayouts;
  const hasCommentDraft = Boolean(
    context.viewMode === "current"
    && !context.interactionLocked
    && draftTarget
    && (draft.trim() || draftAttachments.length > 0),
  );
  const expectedCommentLayoutTargetIds = useMemo(() => [...new Set([
    ...context.visibleCommentItems.map((comment) => comment.target.id),
    ...(
      (hasCommentDraft || composerOpen) && draftTarget
        ? [draftTarget.id]
        : []
    ),
  ])].sort(), [
    composerOpen,
    context.visibleCommentItems,
    draftTarget,
    hasCommentDraft,
  ]);
  const expectedCommentLayoutTargetIdsKey = expectedCommentLayoutTargetIds.join("\u0000");
  const commentLayoutAuthority = canvasSnapshot.layoutAuthority;
  const commentLayoutReady = Boolean(
    context.canvasMode === "edit"
    && commentLayoutAuthority.ready
    && (
      commentLayoutAuthority.textEditing
      || !context.expectedCommentLayoutSourceSha256
      || commentLayoutAuthority.sourceSha256 === context.expectedCommentLayoutSourceSha256
    )
    && commentLayoutAuthority.viewContextGeneration === context.activePageViewGeneration
    && commentLayoutAuthority.targetIdsKey === expectedCommentLayoutTargetIdsKey
    && expectedCommentLayoutTargetIds.every((targetId) => Boolean(targetLayouts[targetId]))
  );
  const draftTargetLayout = draftTarget ? targetLayouts[draftTarget.id] : undefined;
  const draftTargetInOtherTab = Boolean(
    draftTarget?.tagName !== "body"
    && draftTargetLayout?.status === "hidden"
    && draftTargetLayout.tabGroupKey,
  );
  const draftInOtherTab = hasCommentDraft && draftTargetInOtherTab;
  const draftTargetInCurrentTab = Boolean(draftTarget && !draftTargetInOtherTab);
  const draftInCurrentTab = hasCommentDraft && draftTargetInCurrentTab;
  const composerInCurrentTab = composerOpen && draftTargetInCurrentTab;
  const hasCollapsedCommentDraft = Boolean(
    draftInCurrentTab && draftTarget && !composerOpen,
  );
  const commentTargetTops = useMemo(() => Object.fromEntries(
    Object.entries(targetLayouts)
      .filter(([, layout]) => layout.status === "visible" && Number.isFinite(layout.top))
      .map(([targetId, layout]) => [targetId, layout.top as number]),
  ), [targetLayouts]);
  const otherTabCommentItems = useMemo(() => context.visibleCommentItems.filter(
    (comment) => {
      const layout = targetLayouts[comment.target.id];
      return Boolean(
        comment.target.tagName !== "body"
        && layout?.status === "hidden"
        && layout.tabGroupKey
      );
    },
  ), [context.visibleCommentItems, targetLayouts]);
  const otherTabCommentIds = useMemo(
    () => new Set(otherTabCommentItems.map((comment) => comment.commentId)),
    [otherTabCommentItems],
  );
  const railCommentItems = useMemo(
    () => context.visibleCommentItems.filter(
      (comment) => !otherTabCommentIds.has(comment.commentId),
    ),
    [context.visibleCommentItems, otherTabCommentIds],
  );
  const otherTabCommentGroups = useMemo<OtherTabCommentGroup[]>(() => {
    const grouped = new Map<string, OtherTabCommentGroup>();
    const appendEntry = (key: string, label: string, entry: OtherTabCommentEntry) => {
      const current = grouped.get(key);
      if (current) current.entries.push(entry);
      else grouped.set(key, { key, label, entries: [entry] });
    };
    for (const comment of otherTabCommentItems) {
      const layout = targetLayouts[comment.target.id];
      appendEntry(
        layout?.tabGroupKey || comment.target.id,
        layout?.tabGroupLabel || "其他标签页",
        {
          kind: "saved",
          key: comment.commentId,
          target: comment.target,
          comment,
          previewText: comment.text.trim()
            || `已添加 ${(comment.attachments ?? []).length} 个附件`,
        },
      );
    }
    if (draftInOtherTab && draftTarget && draftTargetLayout?.tabGroupKey) {
      appendEntry(
        draftTargetLayout.tabGroupKey,
        draftTargetLayout.tabGroupLabel || "其他标签页",
        {
          kind: "draft",
          key: "__composer",
          target: draftTarget,
          previewText: draft.trim() || `已添加 ${draftAttachments.length} 个附件`,
        },
      );
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => {
        const sameTarget = commentMarkerGroupKey(left.target)
          === commentMarkerGroupKey(right.target);
        if (sameTarget) {
          if (left.kind !== right.kind) return left.kind === "saved" ? -1 : 1;
          if (left.kind === "saved" && right.kind === "saved") {
            return left.comment.createdAt.localeCompare(right.comment.createdAt);
          }
          return 0;
        }
        const position = (
          (left.target.sourceAnchor?.startOffset ?? Number.MAX_SAFE_INTEGER)
          - (right.target.sourceAnchor?.startOffset ?? Number.MAX_SAFE_INTEGER)
        );
        if (position !== 0) return position;
        if (left.kind !== right.kind) return left.kind === "saved" ? -1 : 1;
        if (left.kind === "saved" && right.kind === "saved") {
          return left.comment.createdAt.localeCompare(right.comment.createdAt);
        }
        return 0;
      }),
    }));
  }, [
    draft,
    draftAttachments.length,
    draftInOtherTab,
    draftTarget,
    draftTargetLayout,
    otherTabCommentItems,
    targetLayouts,
  ]);
  const otherTabCommentEntryCount = otherTabCommentItems.length + (draftInOtherTab ? 1 : 0);
  const otherTabCommentsOpen = (
    expandedOtherTabCommentsKey === context.otherTabCommentsContextKey
  );
  const hasUnsavedCommentEdit = Boolean(
    context.viewMode === "current"
    && context.unfinishedEditedComment
    && commentEditSessionHasChanges(commentEditSession),
  );
  const relinkRailCardVisible = Boolean(
    commentLayoutReady
    && context.viewMode === "current"
    && !context.interactionLocked
    && context.unsafeRelinkCommentItems.length > 0,
  );
  const commentRailMinimumTop = Math.max(82, 14 + commentHeaderHeight + 16)
    + (relinkRailCardVisible ? 96 : 0);
  const isLocatable = useCallback((target: HtmlCanvasSelection): boolean => {
    const layout = targetLayouts[target.id];
    const resolution = layout?.resolution ?? target.resolution;
    return layout?.status !== "missing"
      && (resolution === "exact" || resolution === "rebound");
  }, [targetLayouts]);
  const draftTargetCanSave = Boolean(
    draftTarget
    && targetLayouts[draftTarget.id]?.status !== "missing"
    && (targetLayouts[draftTarget.id]?.resolution ?? draftTarget.resolution) === "exact"
  );
  const commentRailTargetTops = useMemo(() => {
    if (!commentLayoutReady) return {};
    const targets = [
      ...railCommentItems.map((comment) => comment.target),
      ...(
        (composerInCurrentTab || hasCollapsedCommentDraft) && draftTarget
          ? [draftTarget]
          : []
      ),
    ];
    const measuredGroupTops = new Map<string, number>();
    for (const target of targets) {
      const layout = targetLayouts[target.id];
      const measuredTop = target.tagName === "body" || layout?.status === "missing"
        ? commentRailMinimumTop
        : commentTargetTops[target.id];
      if (!Number.isFinite(measuredTop)) continue;
      const groupKey = commentMarkerGroupKey(target);
      measuredGroupTops.set(
        groupKey,
        Math.min(
          measuredGroupTops.get(groupKey) ?? Number.MAX_SAFE_INTEGER,
          measuredTop as number,
        ),
      );
    }
    return Object.fromEntries(targets.flatMap((target) => {
      const top = measuredGroupTops.get(commentMarkerGroupKey(target));
      return Number.isFinite(top) ? [[target.id, top as number]] : [];
    }));
  }, [
    commentLayoutReady,
    commentRailMinimumTop,
    commentTargetTops,
    composerInCurrentTab,
    draftTarget,
    hasCollapsedCommentDraft,
    railCommentItems,
    targetLayouts,
  ]);
  const sortedVisibleCommentItems = useMemo(() => {
    if (!commentLayoutReady) return [];
    return railCommentItems
      .flatMap((comment, index) => {
        const targetTop = comment.target.tagName === "body"
          ? commentRailMinimumTop
          : commentRailTargetTops[comment.target.id];
        if (!Number.isFinite(targetTop)) return [];
        return [{
          comment,
          index,
          scopeRank: comment.target.tagName === "body" ? 0 : 1,
          targetTop: targetTop as number,
        }];
      })
      .sort((left, right) => (
        left.scopeRank - right.scopeRank
        || left.targetTop - right.targetTop
        || left.comment.createdAt.localeCompare(right.comment.createdAt)
        || left.index - right.index
      ))
      .map(({ comment }) => comment);
  }, [commentLayoutReady, commentRailMinimumTop, commentRailTargetTops, railCommentItems]);
  const commentMeasurementKeys = useMemo(() => Object.fromEntries(
    sortedVisibleCommentItems.map((comment) => {
      const layout = targetLayouts[comment.target.id];
      const resolution = layout?.resolution ?? comment.target.resolution;
      return [comment.commentId, commentMeasurementKey(comment.commentId, {
        resolution,
        locatable: layout?.status !== "missing"
          && (resolution === "exact" || resolution === "rebound"),
        editable: context.viewMode === "current" && !context.interactionLocked,
        editing: editingCommentId === comment.commentId,
        deleting: pendingDeleteCommentId === comment.commentId,
        relinking: relinkingTarget === comment.commentId,
        text: comment.text,
        attachments: (comment.attachments ?? []).map((attachment) => ({
          id: attachment.attachmentId,
          kind: attachment.kind,
          bytes: attachment.byteLength,
        })),
      })];
    }),
  ), [
    context.interactionLocked,
    pendingDeleteCommentId,
    context.viewMode,
    editingCommentId,
    relinkingTarget,
    sortedVisibleCommentItems,
    targetLayouts,
  ]);
  const composerMeasurementKey = useMemo(() => commentMeasurementKey(
    "__composer",
    {
      canSave: draftTargetCanSave,
      deleting: pendingDeleteCommentId === "__composer",
      relinking: relinkingTarget === "__composer",
      text: draft,
      attachments: draftAttachments.map((attachment) => ({
        id: attachment.attachmentId,
        kind: attachment.kind,
        bytes: attachment.byteLength,
      })),
      uploading: attachmentUploadCount > 0,
    },
  ), [
    attachmentUploadCount,
    pendingDeleteCommentId,
    draft,
    draftAttachments,
    draftTargetCanSave,
    relinkingTarget,
  ]);
  const draftRecoveryMeasurementKey = useMemo(() => commentMeasurementKey(
    "__draft_recovery",
    { text: draft, attachments: draftAttachments.length },
  ), [draft, draftAttachments.length]);
  const commentRailLayout = useMemo(() => {
    const items = sortedVisibleCommentItems.map((comment, index) => {
      const imageCount = (comment.attachments ?? []).filter(
        (attachment) => attachment.kind === "image",
      ).length;
      const fileCount = (comment.attachments ?? []).length - imageCount;
      const textLines = Math.max(1, Math.ceil((comment.text.length || 18) / 25));
      const imageRows = Math.ceil(imageCount / 3);
      const measurementKey = commentMeasurementKeys[comment.commentId];
      return {
        key: comment.commentId,
        targetTop: comment.target.tagName === "body"
          ? commentRailMinimumTop
          : commentRailTargetTops[comment.target.id],
        height: commentCardHeights[measurementKey]
          || 104
            + textLines * 19
            + imageRows * 78
            + fileCount * 48
            + (!isLocatable(comment.target) && context.viewMode === "current" ? 70 : 0)
            + (editingCommentId === comment.commentId ? 92 : 0)
            + (pendingDeleteCommentId === comment.commentId ? 46 : 0),
        order: index + 1,
        scopeRank: comment.target.tagName === "body" ? 0 : 1,
      };
    });
    const draftTargetTop = draftTarget?.tagName === "body"
      ? commentRailMinimumTop
      : draftTarget
        ? commentRailTargetTops[draftTarget.id]
        : undefined;
    if (composerInCurrentTab && draftTarget && Number.isFinite(draftTargetTop)) {
      items.push({
        key: "__composer",
        targetTop: draftTargetTop as number,
        height: commentCardHeights[composerMeasurementKey]
          || 276
            + (!draftTargetCanSave ? 70 : 0)
            + (pendingDeleteCommentId === "__composer" ? 46 : 0),
        order: Number.MAX_SAFE_INTEGER,
        scopeRank: draftTarget.tagName === "body" ? 0 : 1,
      });
    }
    if (hasCollapsedCommentDraft && draftTarget && Number.isFinite(draftTargetTop)) {
      items.push({
        key: "__draft_recovery",
        targetTop: draftTargetTop as number,
        height: commentCardHeights[draftRecoveryMeasurementKey] || 142,
        order: Number.MAX_SAFE_INTEGER,
        scopeRank: draftTarget.tagName === "body" ? 0 : 1,
      });
    }
    const layout = layoutCommentRailItems({ minimumTop: commentRailMinimumTop, gap: 20, items });
    return {
      ...layout,
      composerTop: layout.positions.__composer,
      draftRecoveryTop: layout.positions.__draft_recovery,
    };
  }, [
    commentCardHeights,
    commentMeasurementKeys,
    commentRailMinimumTop,
    commentRailTargetTops,
    composerInCurrentTab,
    composerMeasurementKey,
    pendingDeleteCommentId,
    context.viewMode,
    draftRecoveryMeasurementKey,
    draftTarget,
    draftTargetCanSave,
    editingCommentId,
    hasCollapsedCommentDraft,
    isLocatable,
    sortedVisibleCommentItems,
  ]);
  const renderedCommentIds = useMemo(() => virtualizedCommentIds({
    ids: sortedVisibleCommentItems.map((comment) => comment.commentId),
    positions: commentRailLayout.positions,
    heights: commentRailLayout.heights,
    viewportTop: Math.max(0, commentViewport.top - commentRailOffset),
    viewportHeight: commentViewport.height,
    forcedIds: [
      context.focusedCommentId,
      editingCommentId,
      pendingDeleteCommentId,
    ].filter((value): value is string => Boolean(value)),
  }), [
    commentRailLayout.heights,
    commentRailLayout.positions,
    commentRailOffset,
    commentViewport.height,
    commentViewport.top,
    context.focusedCommentId,
    pendingDeleteCommentId,
    editingCommentId,
    sortedVisibleCommentItems,
  ]);
  const renderedVisibleCommentItems = useMemo(
    () => sortedVisibleCommentItems.filter(
      (comment) => renderedCommentIds.has(comment.commentId),
    ),
    [renderedCommentIds, sortedVisibleCommentItems],
  );
  const canvasDocumentHeight = canvasSnapshot.canvasDocumentHeight;
  const commentRailContentHeight = Math.max(
    canvasDocumentHeight,
    commentRailLayout.bottom + 24,
  );
  const commentRailMinimumOffset = computeCommentRailMinimumOffset({
    contentBottom: commentRailLayout.bottom + 14,
    viewportBottom: canvasDocumentHeight - 14,
  });

  useEffect(() => {
    const stage = context.reviewStageRef.current;
    if (!stage) return undefined;
    let frame = 0;
    const updateViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = { top: Math.max(0, stage.scrollTop), height: Math.max(1, stage.clientHeight) };
        setCommentViewport((current) => (
          current.top === next.top && current.height === next.height ? current : next
        ));
      });
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateViewport);
    observer?.observe(stage);
    stage.addEventListener("scroll", updateViewport, { passive: true });
    updateViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      stage.removeEventListener("scroll", updateViewport);
    };
  }, [context.reviewStageRef]);

  useEffect(() => {
    const header = commentsHeaderRef.current;
    if (!header || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const next = Math.ceil(header.getBoundingClientRect().height);
      setCommentHeaderHeight((current) => next > 0 && next !== current ? next : current);
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, [context.canvasMode]);

  useLayoutEffect(() => {
    const root = commentsPanelRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const nodes = [...root.querySelectorAll<HTMLElement>("[data-comment-measure]")];
      const measured = Object.fromEntries(nodes.map((node) => [
        String(
          node.dataset.commentMeasureKey
          || commentMeasurementKey(String(node.dataset.commentMeasure), { compatibility: true })
        ),
        Math.ceil(node.getBoundingClientRect().height),
      ]));
      const activeKeys = new Set([
        ...railCommentItems.map((comment) => comment.commentId),
        ...(composerInCurrentTab ? ["__composer"] : []),
        ...(draftInCurrentTab && !composerOpen ? ["__draft_recovery"] : []),
      ]);
      setCommentCardHeights((current) => {
        const next = Object.fromEntries(
          Object.entries({ ...current, ...measured })
            .filter(([key]) => activeKeys.has(key.split("::", 1)[0])),
        );
        const entries = Object.entries(next);
        if (
          Object.keys(current).length === entries.length
          && entries.every(([key, height]) => current[key] === height)
        ) return current;
        return next;
      });
    };
    const observer = new ResizeObserver(update);
    const observed = new Set<HTMLElement>();
    const refreshObservedNodes = () => {
      const nodes = new Set([...root.querySelectorAll<HTMLElement>("[data-comment-measure]")]);
      for (const node of observed) {
        if (nodes.has(node)) continue;
        observer.unobserve(node);
        observed.delete(node);
      }
      for (const node of nodes) {
        if (observed.has(node)) continue;
        observed.add(node);
        observer.observe(node);
      }
      update();
    };
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(refreshObservedNodes);
    mutationObserver?.observe(root, {
      attributes: true,
      attributeFilter: ["data-comment-measure-key"],
      childList: true,
      subtree: true,
    });
    refreshObservedNodes();
    return () => {
      mutationObserver?.disconnect();
      observer.disconnect();
    };
  }, [
    composerInCurrentTab,
    composerOpen,
    draftInCurrentTab,
    railCommentItems,
  ]);

  useEffect(() => {
    commentRailOffsetRef.current = commentRailOffset;
  }, [commentRailOffset]);

  useLayoutEffect(() => {
    commentRailMinimumOffsetRef.current = commentRailMinimumOffset;
    const currentOffset = commentRailOffsetRef.current;
    if (commentRailFollowsFocus || currentOffset >= commentRailMinimumOffset) return;
    commentRailOffsetRef.current = commentRailMinimumOffset;
    setCommentRailOffset(commentRailMinimumOffset);
  }, [commentRailFollowsFocus, commentRailMinimumOffset]);

  useEffect(() => {
    const rail = commentsPanelRef.current;
    if (context.canvasMode !== "edit" || !rail) return undefined;
    const handleWheel = (event: WheelEvent) => {
      const stage = context.reviewStageRef.current;
      if (!stage) return;
      event.preventDefault();
      event.stopPropagation();
      const currentRailOffset = commentRailOffsetRef.current;
      const routed = routeCommentRailWheel({
        pageScrollTop: stage.scrollTop,
        pageMaxScrollTop: Math.max(0, stage.scrollHeight - stage.clientHeight),
        railOffset: currentRailOffset,
        railMinOffset: commentRailMinimumOffsetRef.current,
        deltaY: event.deltaY,
      });
      if (Math.abs(routed.railOffset - currentRailOffset) > 0.01) {
        commentRailOffsetRef.current = routed.railOffset;
        setCommentRailFollowsFocus(false);
        setCommentRailOffset(routed.railOffset);
      }
      if (Math.abs(routed.pageScrollTop - stage.scrollTop) > 0.01) {
        stage.scrollTop = routed.pageScrollTop;
      }
    };
    rail.addEventListener("wheel", handleWheel, { passive: false });
    return () => rail.removeEventListener("wheel", handleWheel);
  }, [context.canvasMode, context.reviewStageRef]);

  useEffect(() => {
    if (
      context.canvasMode === "edit"
      && (context.focusedCommentId || composerOpen || editingCommentId)
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      commentRailOffsetRef.current = 0;
      setCommentRailFollowsFocus(false);
      setCommentRailOffset(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [context.canvasMode, context.focusedCommentId, composerOpen, editingCommentId]);

  useEffect(() => {
    commentRailOffsetRef.current = 0;
    setCommentRailFollowsFocus(false);
    setCommentRailOffset(0);
  }, [canvasSnapshot.railResetRevision]);

  useEffect(() => {
    const request = canvasSnapshot.revealRequest;
    if (!request || !commentLayoutReady) return undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const stage = context.reviewStageRef.current;
        const rail = commentsPanelRef.current;
        if (!stage || !rail) return;
        if (!request.itemKey) {
          commentRailOffsetRef.current = 0;
          setCommentRailFollowsFocus(false);
          setCommentRailOffset(0);
          canvasPort.settleReveal(request.requestId);
          return;
        }
        const item = [...rail.querySelectorAll<HTMLElement>("[data-comment-measure]")]
          .find((node) => node.dataset.commentMeasure === request.itemKey);
        const targetTop = request.target.tagName === "body"
          ? commentRailMinimumTop
          : commentTargetTops[request.target.id];
        if (!Number.isFinite(targetTop) || !item) return;
        const safeTargetTop = Math.max(commentRailMinimumTop, targetTop as number);
        const nextRailOffset = computeAlignedRailOffset({
          targetTop: safeTargetTop,
          cardTop: item.offsetTop ?? safeTargetTop,
          minimumTop: commentRailMinimumTop,
        });
        commentRailOffsetRef.current = nextRailOffset;
        setCommentRailFollowsFocus(true);
        setCommentRailOffset(nextRailOffset);
        const desiredTop = Math.max(0, safeTargetTop - commentRailMinimumTop - 10);
        const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        stage.scrollTo({
          top: Math.min(desiredTop, maxTop),
          behavior: reduceMotion ? "auto" : "smooth",
        });
        canvasPort.settleReveal(request.requestId);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    canvasPort,
    canvasSnapshot.revealRequest,
    commentLayoutReady,
    commentRailMinimumTop,
    commentTargetTops,
    context.reviewStageRef,
    renderedVisibleCommentItems,
  ]);

  useLayoutEffect(() => {
    const revision = canvasSnapshot.composerFocusRevision;
    if (
      revision <= handledComposerFocusRevisionRef.current
      || !composerInCurrentTab
      || !commentLayoutReady
      || !Number.isFinite(commentRailLayout.composerTop)
      || context.interactionLocked
    ) return;
    const composerElement = composerRef.current;
    if (!composerElement || composerElement.disabled) return;
    handledComposerFocusRevisionRef.current = revision;
    composerElement.focus({ preventScroll: true });
  }, [
    canvasSnapshot.composerFocusRevision,
    commentLayoutReady,
    commentRailLayout.composerTop,
    composerInCurrentTab,
    context.interactionLocked,
  ]);

  useLayoutEffect(() => {
    const request = canvasSnapshot.editFocusRequest;
    if (!request || request.commentId !== editingCommentId) return;
    const editor = commentEditRef.current;
    if (!editor || editor.disabled) return;
    editor.focus({ preventScroll: true });
    if (request.select) editor.select();
    canvasPort.settleCommentEditFocus(request.requestId);
  }, [canvasPort, canvasSnapshot.editFocusRequest, editingCommentId]);

  const model = useMemo<CommentRailModel>(() => ({
    composer,
    commentsPanelRef,
    commentsHeaderRef,
    composerRef,
    commentEditRef,
    viewMode: context.viewMode,
    commentLayoutReady,
    commentLayoutAuthority,
    commentRailMinimumOffset,
    commentRailFollowsFocus,
    canvasDocumentHeight,
    commentRailContentHeight,
    commentRailOffset,
    commentRailMinimumTop,
    visibleCommentItems: context.visibleCommentItems,
    draftInCurrentTab,
    hasUnsavedCommentEdit,
    otherTabCommentEntryCount,
    otherTabCommentsContextKey: context.otherTabCommentsContextKey,
    otherTabCommentsOpen,
    interactionLocked: context.interactionLocked,
    unfinishedEditedComment: context.unfinishedEditedComment,
    otherTabCommentGroups,
    activeCommentCount: context.activeCommentCount,
    changeEvents: snapshot.workingCopy?.changeEvents as DirectEditEvent[]
      || context.changeEvents,
    composerInCurrentTab,
    composerTop: commentRailLayout.composerTop,
    focusedCommentId: context.focusedCommentId,
    relinkRailCardVisible,
    relinkCardCopy: relinkNoticeCopy(context.unsafeRelinkCommentItems),
    relinkCardActive: context.relinkCardActive,
    projectLoadError: context.projectLoadError,
    draftTargetScope: draftScope(draftTarget),
    attachmentUploadCount,
    draftTargetCanSave,
    composerMeasurementKey,
    attachmentObjectUrls: context.attachmentObjectUrls,
    pendingDeleteCommentId,
    draftRecoveryTop: commentRailLayout.draftRecoveryTop,
    draftRecoveryMeasurementKey,
    expectedCommentLayoutTargetIds,
    sortedVisibleCommentItems,
    renderedVisibleCommentItems,
    commentTargetLayouts: targetLayouts,
    selection: canvasSnapshot.selection,
    commentMeasurementKeys,
    visibleCommentPositions: commentRailLayout.positions,
  }), [
    attachmentUploadCount,
    canvasDocumentHeight,
    canvasSnapshot.selection,
    commentLayoutAuthority,
    commentLayoutReady,
    commentMeasurementKeys,
    commentRailContentHeight,
    commentRailFollowsFocus,
    commentRailLayout.composerTop,
    commentRailLayout.draftRecoveryTop,
    commentRailLayout.positions,
    commentRailMinimumOffset,
    commentRailMinimumTop,
    commentRailOffset,
    composer,
    composerInCurrentTab,
    composerMeasurementKey,
    context.activeCommentCount,
    context.attachmentObjectUrls,
    context.changeEvents,
    context.focusedCommentId,
    context.interactionLocked,
    context.otherTabCommentsContextKey,
    pendingDeleteCommentId,
    context.projectLoadError,
    context.relinkCardActive,
    context.unfinishedEditedComment,
    context.unsafeRelinkCommentItems,
    context.viewMode,
    context.visibleCommentItems,
    draftInCurrentTab,
    draftRecoveryMeasurementKey,
    draftTarget,
    draftTargetCanSave,
    expectedCommentLayoutTargetIds,
    hasUnsavedCommentEdit,
    otherTabCommentEntryCount,
    otherTabCommentGroups,
    otherTabCommentsOpen,
    relinkRailCardVisible,
    renderedVisibleCommentItems,
    snapshot.workingCopy,
    sortedVisibleCommentItems,
    targetLayouts,
  ]);
  const liveActions = useMemo<CommentRailActions>(() => ({
    ...actions,
    updateDraft: (value) => capability.commands.updateDraft(value),
    updateCommentEditDraft: (value) => capability.commands.updateEditDraft(value),
    toggleOtherTabComments: () => {
      setExpandedOtherTabCommentsKey((current) => (
        current === context.otherTabCommentsContextKey
          ? ""
          : context.otherTabCommentsContextKey
      ));
    },
    collapseOtherTabComments: () => setExpandedOtherTabCommentsKey(""),
    requestDeleteComment: (commentId) => setPendingDeleteCommentId(commentId),
    clearDeleteRequest: () => setPendingDeleteCommentId(null),
    deleteComment: (commentId) => {
      setPendingDeleteCommentId(null);
      actions.deleteComment(commentId);
    },
  }), [actions, capability, context.otherTabCommentsContextKey]);

  return <CommentRailView model={model} actions={liveActions} />;
}, (previous, next) => (
  previous.capability === next.capability
  && previous.canvasPort === next.canvasPort
  && previous.actions === next.actions
  && shallowEqualRecord(
    previous.context as unknown as Record<string, unknown>,
    next.context as unknown as Record<string, unknown>,
    new Set(["composer"]),
  )
  && sameComposer(previous.context.composer, next.context.composer)
));
