"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { BrowsersIcon } from "@phosphor-icons/react/dist/csr/Browsers";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { PaletteIcon } from "@phosphor-icons/react/dist/csr/Palette";
import { PushPinIcon } from "@phosphor-icons/react/dist/csr/PushPin";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { TextTIcon } from "@phosphor-icons/react/dist/csr/TextT";
import { TreeStructureIcon } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";

import {
  buildReviewDocuments,
  type ReviewCommentGroup,
  type ReviewDocuments,
  type ReviewSide,
} from "./review-document";
import {
  REVIEW_RUNTIME_VISUAL_DEADLINE_MS,
  ReviewRuntimeVisualCoordinator,
  mergeReviewRuntimeVisualChanges,
} from "../lib/review-runtime-visual.js";
import { ReviewScrollCoordinator } from "../lib/review-scroll-sync.js";
import {
  DEFAULT_REVIEW_STATE,
  reduceReviewState,
  type ReviewChangeFilter,
  type ReviewPageView,
  type ReviewZoomMode,
} from "./review-state";
import {
  WorkbenchHeaderActions,
  WorkbenchHeaderShell,
} from "./workbench-header-shell";
import type { CommentItem } from "./types";
import styles from "./ai-review-workspace.module.css";

type ConfirmationAction = "return" | "accept";
type ReviewDesktopSession = { sessionId: string; url: string };
type ReviewDesktopSessions = Record<ReviewSide, ReviewDesktopSession>;
type ReviewDesktopSessionResult = {
  documents: ReviewDocuments;
  sessions: ReviewDesktopSessions | null;
  failed: boolean;
};
type ReviewRuntimeVisualResult = {
  documents: ReviewDocuments;
  changes: ReviewDocuments["changes"];
  outline: ReviewDocuments["outline"];
  markers: Array<{ key: string; changeId: string }>;
};
type ReviewCommentLayout = {
  key: string;
  left: number;
  top: number;
  viewportLeft: number;
  viewportTop: number;
  global: boolean;
};

const FILTER_LABELS: Record<ReviewChangeFilter, string> = {
  all: "全部变化",
  text: "文案",
  structure: "结构",
  style: "视觉",
};

const PAGE_VIEW_LABELS: Record<ReviewPageView, string> = {
  split: "双页",
  before: "左页 · 修改前",
  after: "右页 · AI 修改后",
};

const EMPTY_REVIEW_DOCUMENT = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>";
const subscribeHydration = () => () => {};

type ReviewMessage = {
  source?: string;
  sessionId?: string;
  side?: ReviewSide;
  type?: string;
  top?: number;
  left?: number;
  commandId?: string;
  gestureId?: number;
  scrollGeometry?: unknown;
  panelKey?: string;
  panelPath?: string[];
  presentationEpoch?: number;
  actionKey?: string;
  actionType?: "click" | "control-state";
  panelControl?: boolean;
  value?: string;
  checked?: boolean;
  commentLayouts?: unknown;
  challenge?: unknown;
};

const MAX_REVIEW_COMMENT_COORDINATE = 10_000_000;

function createReviewRuntimeVisualChallenge(): string | null {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function safeReviewCommentLayouts(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): ReviewCommentLayout[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const {
      key,
      left,
      top,
      viewportLeft,
      viewportTop,
      global,
    } = candidate as Record<string, unknown>;
    if (
      typeof key !== "string"
      || !allowedKeys.has(key)
      || seen.has(key)
      || typeof left !== "number"
      || typeof top !== "number"
      || typeof viewportLeft !== "number"
      || typeof viewportTop !== "number"
      || !Number.isFinite(left)
      || !Number.isFinite(top)
      || !Number.isFinite(viewportLeft)
      || !Number.isFinite(viewportTop)
      || Math.abs(left) > MAX_REVIEW_COMMENT_COORDINATE
      || Math.abs(top) > MAX_REVIEW_COMMENT_COORDINATE
      || Math.abs(viewportLeft) > MAX_REVIEW_COMMENT_COORDINATE
      || Math.abs(viewportTop) > MAX_REVIEW_COMMENT_COORDINATE
    ) return [];
    seen.add(key);
    return [{
      key,
      left,
      top,
      viewportLeft,
      viewportTop,
      global: global === true,
    }];
  });
}

function postToFrame(
  frame: HTMLIFrameElement | null,
  sessionId: string,
  message: Record<string, unknown>,
) {
  frame?.contentWindow?.postMessage({
    source: "pageroot-ai-review-parent",
    sessionId,
    ...message,
  }, "*");
}

function ReviewDocumentPane({
  side,
  html,
  label,
  zoom,
  onFrame,
  onScale,
  onViewport,
  onHorizontalScroll,
  independentTransport,
  frameUrl,
  loadFailed,
  visible,
  commentGroups,
  commentLayouts,
}: {
  side: ReviewSide;
  html: string;
  label: string;
  zoom: ReviewZoomMode;
  onFrame: (side: ReviewSide, frame: HTMLIFrameElement | null) => void;
  onScale: (side: ReviewSide, scale: number) => void;
  onViewport: (side: ReviewSide, viewport: HTMLDivElement | null) => void;
  onHorizontalScroll: (side: ReviewSide) => void;
  independentTransport: boolean;
  frameUrl?: string;
  loadFailed: boolean;
  visible: boolean;
  commentGroups: readonly ReviewCommentGroup[];
  commentLayouts: readonly ReviewCommentLayout[];
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 590, height: 620 });
  const [viewportScrollLeft, setViewportScrollLeft] = useState(0);

  const assignViewport = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    onViewport(side, element);
  }, [onViewport, side]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.max(320, bounds.width),
        height: Math.max(360, bounds.height),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const documentViewportWidth = Math.max(1180, viewportSize.width);
  const scale = zoom === "fit"
    ? Math.min(1, viewportSize.width / documentViewportWidth)
    : 1;
  const renderedWidth = documentViewportWidth * scale;
  const iframeHeight = Math.max(620, viewportSize.height / scale);
  const commentLayoutsByKey = new Map(commentLayouts.map((layout) => [layout.key, layout]));

  useEffect(() => {
    onScale(side, scale);
  }, [onScale, scale, side]);

  useEffect(() => () => {
    onFrame(side, null);
    onViewport(side, null);
  }, [onFrame, onViewport, side]);

  const renderCommentMarker = (group: ReviewCommentGroup) => {
    const layout = commentLayoutsByKey.get(group.key);
    if (!layout) return null;
    const left = Math.max(12, Math.min(documentViewportWidth - 12, layout.left)) * scale;
    const top = Math.max(12, layout.top) * scale;
    const visibleLeft = layout.viewportLeft * scale - viewportScrollLeft;
    const visibleTop = layout.viewportTop * scale;
    const placement = visibleLeft < viewportSize.width * .55 ? "right" : "left";
    const verticalPlacement = visibleTop < 96
      ? "below"
      : visibleTop > viewportSize.height - 96
        ? "above"
        : "center";
    const commentText = group.items.map((item) => item.text).join("；");
    return (
      <span
        key={group.key}
        className={styles.reviewCommentMarker}
        data-testid="review-comment-marker"
        data-comment-key={group.key}
        data-bubble-placement={placement}
        data-bubble-vertical={verticalPlacement}
        role="note"
        aria-label={`用户评论：${commentText}`}
        style={{ left, top }}
        onPointerEnter={(event) => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          const markerBounds = event.currentTarget.getBoundingClientRect();
          const viewportBounds = viewport.getBoundingClientRect();
          const centerX = markerBounds.left + markerBounds.width / 2 - viewportBounds.left;
          const centerY = markerBounds.top + markerBounds.height / 2 - viewportBounds.top;
          event.currentTarget.dataset.bubblePlacement = centerX < viewportBounds.width * .55
            ? "right"
            : "left";
          event.currentTarget.dataset.bubbleVertical = centerY < 96
            ? "below"
            : centerY > viewportBounds.height - 96
              ? "above"
              : "center";
        }}
      >
        <span aria-hidden="true">评</span>
        <span
          className={styles.reviewCommentBubble}
          data-testid="review-comment-bubble"
          aria-hidden="true"
        >
          <strong>用户评论</strong>
          {group.items.map((item, index) => (
            <span className={styles.reviewCommentItem} key={`${group.key}-${index}`}>
              <span>{item.text}</span>
              {item.attachmentCount > 0 && !item.text.startsWith("已添加 ") ? (
                <small>{item.attachmentCount} 个参考附件</small>
              ) : null}
            </span>
          ))}
        </span>
      </span>
    );
  };

  return (
    <section
      className={styles.documentPane}
      data-side={side}
      hidden={!visible}
      aria-label={`${side === "before" ? "修改前" : "修改后"}${label}完整页面`}
    >
      <header className={styles.documentPaneHeader}>
        <span aria-hidden="true" />
        <div>
          <strong>{side === "before" ? "修改前" : "AI 修改后"}</strong>
          <small>{label}</small>
        </div>
      </header>
      <div
        className={styles.documentViewport}
        ref={assignViewport}
        data-zoom={zoom}
        tabIndex={0}
        aria-label={`${side === "before" ? "修改前" : "修改后"}画布滚动区`}
        aria-busy={independentTransport && !frameUrl && !loadFailed}
        onScroll={(event) => {
          setViewportScrollLeft(event.currentTarget.scrollLeft);
          onHorizontalScroll(side);
        }}
      >
        {loadFailed ? (
          <div className={styles.frameError} role="alert">
            审阅画布未能安全载入，请返回本轮处理页面后重试。
          </div>
        ) : null}
        <div
          className={styles.documentScale}
          style={{ width: renderedWidth, height: viewportSize.height }}
        >
          <iframe
            ref={iframeRef}
            key={independentTransport ? frameUrl || `${side}-pending` : side}
            {...(independentTransport
              ? { src: frameUrl || "about:blank" }
              : { srcDoc: html })}
            title={`${side === "before" ? "修改前" : "修改后"} ${label}`}
            loading="eager"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            style={{
              width: documentViewportWidth,
              height: iframeHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            onLoad={() => {
              if (loadFailed || (independentTransport && !frameUrl)) return;
              const frame = iframeRef.current;
              if (!frame) return;
              onFrame(side, frame);
              if (viewportRef.current) viewportRef.current.scrollLeft = 0;
            }}
          />
          {commentGroups.length ? (
            <div className={styles.reviewCommentLayer}>
              <div className={styles.reviewCommentContentLayer}>
                {commentGroups.filter((group) => (
                  commentLayoutsByKey.get(group.key)?.global !== true
                )).map(renderCommentMarker)}
              </div>
              {commentGroups.filter((group) => (
                commentLayoutsByKey.get(group.key)?.global === true
              )).map(renderCommentMarker)}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function AiReviewWorkspace({
  fileName,
  beforeLabel,
  afterLabel,
  beforeHtml,
  afterHtml,
  comments,
  sourcePath,
  accepting,
  error,
  notice,
  onExit,
  onReturnBefore,
  onAccept,
  onRevealCandidateHtml,
}: {
  fileName: string;
  beforeLabel: string;
  afterLabel: string;
  beforeHtml: string;
  afterHtml: string;
  comments: readonly CommentItem[];
  sourcePath?: string;
  accepting: boolean;
  error?: string;
  notice?: string;
  onExit: () => void;
  onReturnBefore: () => void;
  onAccept: () => void;
  onRevealCandidateHtml: () => void;
}) {
  const sessionId = `review-${useId().replace(/:/g, "-")}`;
  const fileTitle = fileName.replace(/\.(?:html?|xhtml)$/iu, "") || fileName;
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const independentTransport = hydrated && Boolean(window.htmlAIPreview);
  const documents = useMemo<ReviewDocuments>(() => (
    hydrated
      ? buildReviewDocuments(beforeHtml, afterHtml, {
          sessionId,
          sourcePath,
          externalBootstrap: independentTransport,
          comments,
        })
      : {
          before: EMPTY_REVIEW_DOCUMENT,
          after: EMPTY_REVIEW_DOCUMENT,
          bootstrapJavaScript: { before: "", after: "" },
          changes: [],
          outline: [],
          runtimeVisualCandidates: [],
          commentGroups: [],
        }
  ), [afterHtml, beforeHtml, comments, hydrated, independentTransport, sessionId, sourcePath]);
  const [reviewState, dispatchReviewState] = useReducer(
    reduceReviewState,
    DEFAULT_REVIEW_STATE,
  );
  const {
    pageView: canvasView,
    changeFilter: filter,
    contextVisibility: transparency,
    navigationTarget: focus,
    pagePresentationPath,
    scrollMode,
    zoomMode: zoom,
  } = reviewState;
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const [mapPeeked, setMapPeeked] = useState(false);
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);
  const [desktopSessionResult, setDesktopSessionResult] =
    useState<ReviewDesktopSessionResult | null>(null);
  const [runtimeVisualResult, setRuntimeVisualResult] =
    useState<ReviewRuntimeVisualResult | null>(null);
  const [commentLayoutState, setCommentLayoutState] = useState<{
    documents: ReviewDocuments;
    layouts: ReviewCommentLayout[];
  }>({ documents, layouts: [] });
  const continueReviewButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const mapDrawerRef = useRef<HTMLElement>(null);
  const reviewInitializedRef = useRef(false);
  const framesRef = useRef<Record<ReviewSide, HTMLIFrameElement | null>>({
    before: null,
    after: null,
  });
  const viewportsRef = useRef<Record<ReviewSide, HTMLDivElement | null>>({
    before: null,
    after: null,
  });
  const scalesRef = useRef<Record<ReviewSide, number>>({ before: 1, after: 1 });
  const horizontalFollowerRef = useRef<ReviewSide | null>(null);
  const scrollCoordinatorRef = useRef<ReviewScrollCoordinator | null>(null);
  const frameScrollPositionsRef = useRef<Record<ReviewSide, { top: number; left: number }>>({
    before: { top: 0, left: 0 },
    after: { top: 0, left: 0 },
  });
  const presentationEpochRef = useRef(0);
  const presentationReadyRef = useRef<{
    epoch: number;
    expected: Set<ReviewSide>;
    ready: Set<ReviewSide>;
    afterCommit: Array<() => void>;
    timer: number | null;
  } | null>(null);
  const runtimeVisualCoordinatorRef = useRef<ReviewRuntimeVisualCoordinator | null>(null);
  const runtimeVisualReadySidesRef = useRef<Set<ReviewSide>>(new Set());
  const runtimeVisualResolutionRef = useRef<ReviewRuntimeVisualResult | null>(null);
  const runtimeVisualPortsRef = useRef<Record<ReviewSide, MessagePort | null>>({
    before: null,
    after: null,
  });
  const runtimeVisualChannelChallengesRef = useRef<Record<ReviewSide, string | null>>({
    before: null,
    after: null,
  });
  const reviewStateRef = useRef({ filter, focus, transparency, pagePresentationPath });
  const scrollModeRef = useRef(scrollMode);
  const desktopSessions = desktopSessionResult?.documents === documents
    ? desktopSessionResult.sessions
    : null;
  const reviewLoadFailed = desktopSessionResult?.documents === documents
    ? desktopSessionResult.failed
    : false;
  const reviewCommentLayouts = commentLayoutState.documents === documents
    ? commentLayoutState.layouts
    : [];
  const activeRuntimeVisualResult = runtimeVisualResult?.documents === documents
    ? runtimeVisualResult
    : null;
  const runtimeVisualPending = documents.runtimeVisualCandidates.length > 0
    && !activeRuntimeVisualResult;
  const reviewChanges = activeRuntimeVisualResult?.changes || documents.changes;
  const reviewOutline = activeRuntimeVisualResult?.outline || documents.outline;
  const navigableChanges = useMemo(() => (
    filter === "all"
      ? reviewChanges
      : reviewChanges.filter((change) => change.types.includes(filter))
  ), [filter, reviewChanges]);
  const activeChange = focus === "all"
    ? null
    : reviewChanges.find((change) => change.id === focus) || null;
  const activeIndex = activeChange
    ? navigableChanges.findIndex((change) => change.id === activeChange.id)
    : -1;
  const outlineGroups = useMemo(() => {
    const grouped = new Map<string, ReviewDocuments["outline"]>();
    reviewOutline.forEach((item) => {
      const items = grouped.get(item.group) || [];
      items.push(item);
      grouped.set(item.group, items);
    });
    return [...grouped.entries()].map(([label, items]) => ({ label, items }));
  }, [reviewOutline]);
  const mapOpen = mapPinned || mapPeeked;

  const closeRuntimeVisualChannels = useCallback(() => {
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      const port = runtimeVisualPortsRef.current[side];
      if (port) {
        port.onmessage = null;
        port.close();
      }
      runtimeVisualPortsRef.current[side] = null;
      runtimeVisualChannelChallengesRef.current[side] = null;
    });
  }, []);

  const updateCommentScrollTransform = useCallback((
    side: ReviewSide,
    top: number,
    left: number,
  ) => {
    const safeTop = Number.isFinite(top) ? Math.max(0, top) : 0;
    const safeLeft = Number.isFinite(left) ? Math.max(0, left) : 0;
    frameScrollPositionsRef.current[side] = { top: safeTop, left: safeLeft };
    const viewport = viewportsRef.current[side];
    if (!viewport) return;
    const scale = scalesRef.current[side];
    viewport.style.setProperty("--review-comment-scroll-x", `${safeLeft * scale}px`);
    viewport.style.setProperty("--review-comment-scroll-y", `${safeTop * scale}px`);
  }, []);

  useEffect(() => {
    const coordinator = new ReviewScrollCoordinator({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (handle) => window.clearTimeout(handle),
      now: () => performance.now(),
      applyFollower: (side, command) => {
        updateCommentScrollTransform(side, command.top, command.left);
        postToFrame(framesRef.current[side], sessionId, {
          type: "set-scroll-position",
          ...command,
        });
      },
      onOwnerChange: (owner) => {
        (['before', 'after'] as ReviewSide[]).forEach((side) => {
          postToFrame(framesRef.current[side], sessionId, {
            type: "scroll-owner",
            ...owner,
          });
        });
      },
    });
    scrollCoordinatorRef.current = coordinator;
    coordinator.setLinked(scrollModeRef.current === "linked");
    return () => {
      coordinator.setLinked(false);
      coordinator.reset();
      if (scrollCoordinatorRef.current === coordinator) scrollCoordinatorRef.current = null;
    };
  }, [sessionId, updateCommentScrollTransform]);

  useEffect(() => {
    scrollModeRef.current = scrollMode;
    scrollCoordinatorRef.current?.setLinked(scrollMode === "linked");
  }, [scrollMode]);

  useEffect(() => {
    scrollCoordinatorRef.current?.reset();
  }, [documents]);

  useEffect(() => {
    if (!hydrated || reviewInitializedRef.current) return;
    reviewInitializedRef.current = true;
    dispatchReviewState({
      type: "set-navigation-target",
      value: documents.changes[0]?.id || "all",
    });
  }, [documents.changes, hydrated]);

  useEffect(() => {
    if (
      !activeRuntimeVisualResult
      || documents.changes.length > 0
      || reviewStateRef.current.focus !== "all"
      || !reviewChanges[0]
    ) return;
    dispatchReviewState({
      type: "set-navigation-target",
      value: reviewChanges[0].id,
    });
  }, [activeRuntimeVisualResult, documents.changes.length, reviewChanges]);

  useEffect(() => {
    if (!mapOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && mapDrawerRef.current?.contains(target)) return;
      setMapPinned(false);
      setMapPeeked(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [mapOpen]);

  useEffect(() => {
    reviewStateRef.current = { filter, focus, transparency, pagePresentationPath };
  }, [filter, focus, pagePresentationPath, transparency]);

  const sendState = useCallback((side?: ReviewSide) => {
    if (
      documents.runtimeVisualCandidates.length > 0
      && runtimeVisualResolutionRef.current?.documents !== documents
    ) return;
    const state = reviewStateRef.current;
    const sides: ReviewSide[] = side ? [side] : ["before", "after"];
    sides.forEach((targetSide) => {
      postToFrame(framesRef.current[targetSide], sessionId, {
        type: "state",
        state: {
          filter: state.filter,
          focus: state.focus,
          transparency: state.transparency,
          scale: scalesRef.current[targetSide],
        },
      });
    });
  }, [documents, sessionId]);

  const commitRuntimeVisualFrame = useCallback((
    side: ReviewSide,
    result: ReviewRuntimeVisualResult,
  ) => {
    postToFrame(framesRef.current[side], sessionId, {
      type: "apply-runtime-visual-changes",
      markers: result.markers,
    });
    sendState(side);
    const currentFocus = reviewStateRef.current.focus;
    if (currentFocus === "all") return;
    const selectedChange = result.changes.find((change) => change.id === currentFocus);
    if (!selectedChange) return;
    postToFrame(framesRef.current[side], sessionId, {
      type: "focus-change",
      changeId: currentFocus,
      panelKey: selectedChange.panelKey,
      panelPath: selectedChange.panelPath,
      behavior: "auto",
    });
  }, [sendState, sessionId]);

  const resolveRuntimeVisuals = useCallback((changedCandidateKeys: readonly string[]) => {
    const merged = mergeReviewRuntimeVisualChanges(documents, changedCandidateKeys);
    const result: ReviewRuntimeVisualResult = {
      documents,
      changes: [...merged.changes],
      outline: [...merged.outline],
      markers: [...merged.markers],
    };
    runtimeVisualResolutionRef.current = result;
    setRuntimeVisualResult(result);
    runtimeVisualReadySidesRef.current.forEach((side) => {
      commitRuntimeVisualFrame(side, result);
    });
  }, [commitRuntimeVisualFrame, documents]);

  useEffect(() => {
    runtimeVisualCoordinatorRef.current?.dispose();
    runtimeVisualCoordinatorRef.current = null;
    closeRuntimeVisualChannels();
    runtimeVisualReadySidesRef.current = new Set();
    runtimeVisualResolutionRef.current = null;
    if (!documents.runtimeVisualCandidates.length) {
      runtimeVisualResolutionRef.current = {
        documents,
        changes: documents.changes,
        outline: documents.outline,
        markers: [],
      };
      return undefined;
    }
    const coordinator = new ReviewRuntimeVisualCoordinator({
      candidates: documents.runtimeVisualCandidates,
      deadlineMs: REVIEW_RUNTIME_VISUAL_DEADLINE_MS,
      onResolve: resolveRuntimeVisuals,
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    });
    runtimeVisualCoordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      closeRuntimeVisualChannels();
      if (runtimeVisualCoordinatorRef.current === coordinator) {
        runtimeVisualCoordinatorRef.current = null;
      }
    };
  }, [closeRuntimeVisualChannels, documents, resolveRuntimeVisuals]);

  const finishPagePresentation = useCallback((epoch: number) => {
    const pending = presentationReadyRef.current;
    if (!pending || pending.epoch !== epoch) return;
    if (pending.timer !== null) window.clearTimeout(pending.timer);
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "commit-presentation",
        presentationEpoch: epoch,
      });
    });
    presentationReadyRef.current = null;
    pending.afterCommit.forEach((callback) => callback());
  }, [sessionId]);

  const coordinatePagePresentation = useCallback((
    rawPath: readonly string[],
    afterCommit?: () => void,
  ) => {
    const panelPath = [...new Set(rawPath.filter((key) => /^panel-\d+$/u.test(key)))];
    if (!panelPath.length) {
      afterCommit?.();
      return;
    }
    const previous = presentationReadyRef.current;
    if (previous?.timer !== null && previous?.timer !== undefined) {
      window.clearTimeout(previous.timer);
    }
    presentationEpochRef.current += 1;
    const epoch = presentationEpochRef.current;
    const expected = new Set<ReviewSide>(
      (["before", "after"] as ReviewSide[]).filter((side) => Boolean(framesRef.current[side])),
    );
    const pending = {
      epoch,
      expected,
      ready: new Set<ReviewSide>(),
      afterCommit: afterCommit ? [afterCommit] : [],
      timer: null as number | null,
    };
    presentationReadyRef.current = pending;
    dispatchReviewState({ type: "set-page-presentation", value: panelPath });
    expected.forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "begin-presentation",
        presentationEpoch: epoch,
      });
    });
    expected.forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "activate-panel",
        panelKey: panelPath.at(-1),
        panelPath,
        presentationEpoch: epoch,
      });
    });
    pending.timer = window.setTimeout(() => finishPagePresentation(epoch), 1_600);
    if (!expected.size) finishPagePresentation(epoch);
  }, [finishPagePresentation, sessionId]);

  useEffect(() => () => {
    const pending = presentationReadyRef.current;
    if (pending?.timer != null) window.clearTimeout(pending.timer);
  }, []);

  useEffect(() => {
    if (!independentTransport) return undefined;
    const previewApi = window.htmlAIPreview;
    if (!previewApi) return undefined;
    let cancelled = false;
    const createdSessions: ReviewDesktopSession[] = [];
    void (async () => {
      try {
        const beforeSession = await previewApi.createSession({
          html: documents.before,
          bootstrapJavaScript: documents.bootstrapJavaScript.before,
          ...(sourcePath ? { sourcePath } : {}),
        });
        createdSessions.push(beforeSession);
        const afterSession = await previewApi.createSession({
          html: documents.after,
          bootstrapJavaScript: documents.bootstrapJavaScript.after,
          ...(sourcePath ? { sourcePath } : {}),
        });
        createdSessions.push(afterSession);
        if (cancelled) return;
        setDesktopSessionResult({
          documents,
          sessions: { before: beforeSession, after: afterSession },
          failed: false,
        });
      } catch {
        if (!cancelled) {
          setDesktopSessionResult({ documents, sessions: null, failed: true });
        }
      }
    })();
    return () => {
      cancelled = true;
      createdSessions.forEach((createdSession) => {
        void previewApi.revokeSession(createdSession.sessionId);
      });
    };
  }, [documents, independentTransport, sourcePath]);

  useEffect(() => {
    sendState();
  }, [filter, focus, sendState, transparency]);

  useEffect(() => {
    if (!confirmationAction) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      continueReviewButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [confirmationAction]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ReviewMessage>) => {
      const message = event.data;
      if (
        !message
        || message.source !== "pageroot-ai-review"
        || message.sessionId !== sessionId
        || (message.side !== "before" && message.side !== "after")
        || event.source !== framesRef.current[message.side]?.contentWindow
      ) return;
      if (message.type === "runtime-visual-channel") {
        const runtimeVisualSide = message.side;
        const port = event.ports.length === 1 ? event.ports[0] : null;
        const expectedChallenge = runtimeVisualChannelChallengesRef.current[runtimeVisualSide];
        if (
          !port
          || typeof message.challenge !== "string"
          || message.challenge !== expectedChallenge
          || runtimeVisualPortsRef.current[message.side]
        ) {
          port?.close();
          return;
        }
        runtimeVisualChannelChallengesRef.current[runtimeVisualSide] = null;
        runtimeVisualPortsRef.current[runtimeVisualSide] = port;
        port.onmessage = (portEvent: MessageEvent<unknown>) => {
          if (runtimeVisualPortsRef.current[runtimeVisualSide] !== port) return;
          const portMessage = portEvent.data as {
            source?: unknown;
            sessionId?: unknown;
            side?: unknown;
            type?: unknown;
            runtimeVisualSnapshots?: unknown;
          } | null;
          if (
            !portMessage
            || portMessage.source !== "pageroot-ai-review-runtime-visual"
            || portMessage.sessionId !== sessionId
            || portMessage.side !== runtimeVisualSide
            || portMessage.type !== "runtime-visual-snapshots"
          ) return;
          runtimeVisualCoordinatorRef.current?.accept(
            runtimeVisualSide,
            portMessage.runtimeVisualSnapshots,
          );
        };
        port.start();
        return;
      }
      if (message.type === "ready") {
        runtimeVisualReadySidesRef.current.add(message.side);
        const resolved = runtimeVisualResolutionRef.current;
        if (resolved?.documents === documents) {
          commitRuntimeVisualFrame(message.side, resolved);
          return;
        }
        return;
      }
      if (message.type === "presentation-ready") {
        const pending = presentationReadyRef.current;
        if (!pending || pending.epoch !== Number(message.presentationEpoch)) return;
        pending.ready.add(message.side);
        if ([...pending.expected].every((side) => pending.ready.has(side))) {
          finishPagePresentation(pending.epoch);
        }
        return;
      }
      if (message.type === "scroll-geometry") {
        scrollCoordinatorRef.current?.updateGeometry(message.side, message.scrollGeometry);
        return;
      }
      if (message.type === "scroll-intent") {
        scrollCoordinatorRef.current?.handleIntent(message.side);
        return;
      }
      if (message.type === "scroll-position") {
        const top = Number(message.top || 0);
        const left = Number(message.left || 0);
        updateCommentScrollTransform(message.side, top, left);
        scrollCoordinatorRef.current?.handlePosition(message.side, {
          top,
          left,
          commandId: message.commandId,
        });
        return;
      }
      if (message.type === "comment-layout") {
        if (message.side !== "before") return;
        const allowedKeys = new Set(documents.commentGroups.map((group) => group.key));
        setCommentLayoutState({
          documents,
          layouts: safeReviewCommentLayouts(message.commentLayouts, allowedKeys),
        });
        return;
      }
      if (
        message.type === "interaction"
        || message.type === "action"
        || message.type === "control-state"
      ) {
        setMapPinned(false);
        setMapPeeked(false);
      }
      if (
        (message.type === "action" || message.type === "control-state")
        && message.actionKey
      ) {
        if (message.panelControl) return;
        const follower: ReviewSide = message.side === "before" ? "after" : "before";
        postToFrame(framesRef.current[follower], sessionId, {
          type: "mirror-action",
          actionKey: message.actionKey,
          panelKey: message.panelKey,
          panelPath: message.panelPath,
          actionType: message.type === "control-state" ? "control-state" : "click",
          value: message.value,
          checked: message.checked,
        });
        return;
      }
      if (message.type === "panel-change") {
        const panelPath = message.panelPath?.length
          ? message.panelPath
          : message.panelKey
            ? [message.panelKey]
            : [];
        const visibleItem = reviewOutline.find((item) => (
          item.panelPath?.at(-1) === panelPath.at(-1)
        ));
        if (visibleItem) {
          dispatchReviewState({
            type: "set-navigation-target",
            value: visibleItem.changeId || visibleItem.id,
          });
        }
        coordinatePagePresentation(panelPath);
        return;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    commitRuntimeVisualFrame,
    coordinatePagePresentation,
    documents,
    finishPagePresentation,
    reviewOutline,
    sessionId,
    updateCommentScrollTransform,
  ]);

  const registerFrame = useCallback((side: ReviewSide, frame: HTMLIFrameElement | null) => {
    framesRef.current[side] = frame;
    if (frame) window.requestAnimationFrame(() => {
      const resolved = runtimeVisualResolutionRef.current;
      const coordinator = runtimeVisualCoordinatorRef.current;
      if (
        coordinator
        && resolved?.documents !== documents
        && !runtimeVisualPortsRef.current[side]
      ) {
        coordinator.start();
        if (!runtimeVisualChannelChallengesRef.current[side]) {
          const challenge = createReviewRuntimeVisualChallenge();
          if (challenge) {
            runtimeVisualChannelChallengesRef.current[side] = challenge;
            postToFrame(frame, sessionId, {
              type: "request-runtime-visual-channel",
              challenge,
            });
          }
        }
      }
      if (resolved?.documents === documents) {
        commitRuntimeVisualFrame(side, resolved);
      }
      const owner = scrollCoordinatorRef.current?.snapshot();
      if (owner) {
        postToFrame(frame, sessionId, {
          type: "scroll-owner",
          linked: owner.linked,
          leader: owner.leader,
          gestureId: owner.gestureId,
        });
      }
    });
  }, [commitRuntimeVisualFrame, documents, sessionId]);

  const registerViewport = useCallback((side: ReviewSide, viewport: HTMLDivElement | null) => {
    viewportsRef.current[side] = viewport;
    const position = frameScrollPositionsRef.current[side];
    if (viewport) updateCommentScrollTransform(side, position.top, position.left);
  }, [updateCommentScrollTransform]);

  const updateScale = useCallback((side: ReviewSide, scale: number) => {
    scalesRef.current[side] = scale;
    const position = frameScrollPositionsRef.current[side];
    updateCommentScrollTransform(side, position.top, position.left);
    const state = reviewStateRef.current;
    postToFrame(framesRef.current[side], sessionId, {
      type: "state",
      state: {
        filter: state.filter,
        focus: state.focus,
        transparency: state.transparency,
        scale,
      },
    });
  }, [sessionId, updateCommentScrollTransform]);

  const handleHorizontalScroll = useCallback((side: ReviewSide) => {
    if (scrollMode !== "linked" || horizontalFollowerRef.current === side) return;
    const source = viewportsRef.current[side];
    const followerSide: ReviewSide = side === "before" ? "after" : "before";
    const follower = viewportsRef.current[followerSide];
    if (!source || !follower) return;
    const sourceMaximum = Math.max(0, source.scrollWidth - source.clientWidth);
    const followerMaximum = Math.max(0, follower.scrollWidth - follower.clientWidth);
    horizontalFollowerRef.current = followerSide;
    follower.scrollLeft = source.scrollLeft <= 1
      ? 0
      : sourceMaximum - source.scrollLeft <= 1
        ? followerMaximum
        : Math.min(source.scrollLeft, followerMaximum);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (horizontalFollowerRef.current === followerSide) horizontalFollowerRef.current = null;
    }));
  }, [scrollMode]);

  const selectChange = useCallback((changeId: string) => {
    const selectedChange = reviewChanges.find((change) => change.id === changeId);
    dispatchReviewState({ type: "set-navigation-target", value: changeId });
    const focusChange = () => {
      (["before", "after"] as ReviewSide[]).forEach((side) => {
        postToFrame(framesRef.current[side], sessionId, {
          type: "focus-change",
          changeId,
          panelKey: selectedChange?.panelKey,
          panelPath: selectedChange?.panelPath,
          behavior: "smooth",
        });
      });
    };
    if (selectedChange?.panelPath?.length) {
      coordinatePagePresentation(selectedChange.panelPath, focusChange);
    } else {
      focusChange();
    }
  }, [coordinatePagePresentation, reviewChanges, sessionId]);

  const selectReviewMode = useCallback((mode: ReviewChangeFilter) => {
    dispatchReviewState({ type: "set-change-filter", value: mode });
  }, []);

  const selectPreviewMode = useCallback((mode: ReviewPageView) => {
    dispatchReviewState({ type: "set-page-view", value: mode });
  }, []);

  const selectOutlineItem = useCallback((item: ReviewDocuments["outline"][number]) => {
    if (item.changeId) {
      selectChange(item.changeId);
      return;
    }
    dispatchReviewState({ type: "set-navigation-target", value: item.id });
    const focusOutline = () => {
      (["before", "after"] as ReviewSide[]).forEach((side) => {
        postToFrame(framesRef.current[side], sessionId, {
          type: "focus-outline",
          outlineId: item.id,
          panelKey: item.panelKey,
          panelPath: item.panelPath,
          behavior: "smooth",
        });
      });
    };
    if (item.panelPath?.length) coordinatePagePresentation(item.panelPath, focusOutline);
    else focusOutline();
  }, [coordinatePagePresentation, selectChange, sessionId]);

  const selectPageOverview = useCallback(() => {
    dispatchReviewState({ type: "set-navigation-target", value: "all" });
    const coordinator = scrollCoordinatorRef.current;
    const gestureId = coordinator?.invalidateGesture() || 0;
    const commandBatchId = Date.now();
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      const commandId = `overview-${commandBatchId}-${side}`;
      coordinator?.handlePosition(side, { top: 0, left: 0, commandId });
      updateCommentScrollTransform(side, 0, 0);
      postToFrame(framesRef.current[side], sessionId, {
        type: "set-scroll-position",
        commandId,
        gestureId,
        force: true,
        top: 0,
        left: 0,
      });
    });
  }, [sessionId, updateCommentScrollTransform]);

  const navigate = useCallback((direction: -1 | 1) => {
    if (!navigableChanges.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : (direction > 0 ? -1 : 0);
    const nextIndex = (currentIndex + direction + navigableChanges.length) % navigableChanges.length;
    selectChange(navigableChanges[nextIndex].id);
  }, [activeIndex, navigableChanges, selectChange]);

  const handleSegmentedKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const buttons = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ) || [])];
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0 || !buttons.length) return;

    let targetIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      targetIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      targetIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = buttons.length - 1;
    }

    if (targetIndex === null) return;
    event.preventDefault();
    buttons[targetIndex].focus();
    buttons[targetIndex].click();
  }, []);

  const openConfirmation = useCallback((
    action: ConfirmationAction,
    trigger: HTMLButtonElement,
  ) => {
    confirmationTriggerRef.current = trigger;
    setConfirmationAction(action);
  }, []);

  const closeConfirmation = useCallback(() => {
    setConfirmationAction(null);
    const trigger = confirmationTriggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  const confirmAndContinue = useCallback(() => {
    const action = confirmationAction;
    setConfirmationAction(null);
    if (action === "return") onReturnBefore();
    if (action === "accept") onAccept();
  }, [confirmationAction, onAccept, onReturnBefore]);

  const handleConfirmDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(confirmDialogRef.current?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ) || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1) || first;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [closeConfirmation]);

  return (
    <div className={styles.reviewRoot} data-testid="ai-review-workspace">
      <WorkbenchHeaderShell
        className={styles.reviewHeader}
        inert={confirmationAction ? true : undefined}
      >
        <div className="window-file">
          <span className="window-file-icon-cluster">
            <button
              className="window-file-icon window-file-about-button"
              type="button"
              aria-label="返回本轮处理页面"
              title="返回本轮处理页面"
              onClick={onExit}
            >
              <FileHtmlIcon aria-hidden="true" size={20} weight="duotone" />
            </button>
          </span>
          <div className="window-file-copy">
            <div className="window-file-title-row">
              <strong title={fileName}>{fileTitle}</strong>
            </div>
            <span className="file-meta">
              <span className="file-version-label">审阅 AI 候选</span>
              <span className="save-status" data-persist-state="idle" role="status">
                <span aria-hidden="true" />
                只读对比 · 尚未采用
              </span>
            </span>
          </div>
        </div>

        <WorkbenchHeaderActions aria-label="审阅结果操作">
          <button
            className="recent-run-button"
            type="button"
            disabled={accepting}
            onClick={(event) => openConfirmation("return", event.currentTarget)}
          >
            <ClockCounterClockwiseIcon aria-hidden="true" size={18} weight="duotone" />
            返回 AI 修改前
          </button>
          <button
            className="header-send-button"
            type="button"
            disabled={accepting}
            onClick={(event) => openConfirmation("accept", event.currentTarget)}
          >
            <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
            {accepting ? "正在核对并打开…" : "打开 AI 修改后"}
          </button>
        </WorkbenchHeaderActions>
      </WorkbenchHeaderShell>

      {error ? (
        <div className={styles.reviewError} role="alert">
          <WarningCircleIcon aria-hidden="true" size={17} weight="fill" />
          <span>{error}</span>
        </div>
      ) : null}

      {!error && notice ? (
        <div className={styles.reviewNotice} role="status">
          <WarningCircleIcon aria-hidden="true" size={17} weight="fill" />
          <span>{notice}</span>
        </div>
      ) : null}

      <main
        className={styles.reviewMain}
        inert={confirmationAction || runtimeVisualPending ? true : undefined}
      >
        <section
          className={styles.canvasReview}
          data-toolbar-open={toolbarPinned ? "true" : undefined}
        >
          <div className={styles.canvasToolbarDock}>
            <div className={styles.canvasToolbar}>
              <div className={styles.canvasReviewTitle}>
                <span className={styles.canvasReviewIcon}><EyeIcon aria-hidden="true" size={20} weight="duotone" /></span>
                <span>
                  <strong>审阅模式</strong>
                  <small>{reviewChanges.length} 处变化</small>
                </span>
              </div>

              <div className={`${styles.reviewModeControl} ${styles.pagePreviewControl}`}>
                <span className={styles.toolbarFieldLabel}>页面预览</span>
                <div
                  className={styles.segmented}
                  data-items="3"
                  role="group"
                  aria-label="页面预览"
                >
                  <button
                    type="button"
                    aria-label="双页对比（修改前与 AI 修改后）"
                    title="双页对比"
                    aria-pressed={canvasView === "split"}
                    onClick={() => selectPreviewMode("split")}
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    <BrowsersIcon aria-hidden="true" size={14} weight="duotone" />
                    <span className={styles.previewButtonLabel}><span>双页</span></span>
                  </button>
                  <button
                    type="button"
                    aria-label={`单独查看修改前 ${beforeLabel}`}
                    aria-pressed={canvasView === "before"}
                    onClick={() => selectPreviewMode("before")}
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    <CaretLeftIcon aria-hidden="true" size={14} weight="bold" />
                    <span className={styles.previewButtonLabel}><span>左页</span><small>修改前</small></span>
                  </button>
                  <button
                    type="button"
                    aria-label={`单独查看 AI 修改后 ${afterLabel}`}
                    aria-pressed={canvasView === "after"}
                    onClick={() => selectPreviewMode("after")}
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    <span className={styles.previewButtonLabel}><span>右页</span><small>修改后</small></span>
                  </button>
                </div>
              </div>

              <div className={styles.transparencyField}>
                <span className={styles.toolbarFieldLabel}>
                  <span>上下文可见度</span><output>{transparency}%</output>
                </span>
                <label className={styles.transparencyControl}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={transparency}
                    aria-label="非修改区域上下文可见度"
                    title="调整非修改区域的可见度"
                    style={{ "--mask-position": `${transparency}%` } as CSSProperties}
                    onInput={(event) => dispatchReviewState({
                      type: "set-context-visibility",
                      value: Number(event.currentTarget.value),
                    })}
                  />
                </label>
              </div>

              <div className={styles.reviewModeControl}>
                <span className={styles.toolbarFieldLabel}>变化审阅</span>
                <div
                  className={styles.segmented}
                  data-items="4"
                  role="group"
                  aria-label="变化审阅"
                >
                  {(["all", "text", "structure", "style"] as ReviewChangeFilter[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-label={mode === "all" ? "查看全部变化" : `${FILTER_LABELS[mode]}变化`}
                      aria-pressed={filter === mode}
                      onClick={() => selectReviewMode(mode)}
                      onKeyDown={handleSegmentedKeyDown}
                    >
                      {mode === "all" ? <GitDiffIcon aria-hidden="true" size={14} weight="duotone" /> : null}
                      {mode === "text" ? <TextTIcon aria-hidden="true" size={14} weight="bold" /> : null}
                      {mode === "structure" ? <TreeStructureIcon aria-hidden="true" size={14} weight="duotone" /> : null}
                      {mode === "style" ? <PaletteIcon aria-hidden="true" size={14} weight="duotone" /> : null}
                      <span>{FILTER_LABELS[mode]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.canvasToolGroup}>
                <div className={styles.toolbarField}>
                  <span className={styles.toolbarFieldLabel}>滚动方式</span>
                  <div className={styles.scrollSwitch} aria-label="滚动方式">
                    <button type="button" aria-label="同步滚动" aria-pressed={scrollMode === "linked"} onClick={() => dispatchReviewState({ type: "set-scroll-mode", value: "linked" })}>
                      <LinkIcon aria-hidden="true" size={12} weight="bold" /><span>同步</span>
                    </button>
                    <button type="button" aria-label="独立滚动" aria-pressed={scrollMode === "independent"} onClick={() => dispatchReviewState({ type: "set-scroll-mode", value: "independent" })}>
                      <LinkBreakIcon aria-hidden="true" size={12} weight="bold" /><span>独立</span>
                    </button>
                  </div>
                </div>
                <div className={styles.toolbarField}>
                  <span className={styles.toolbarFieldLabel}>画布缩放</span>
                  <div className={styles.zoomSwitch} aria-label="画布缩放">
                    <button type="button" aria-pressed={zoom === "fit"} onClick={() => dispatchReviewState({ type: "set-zoom-mode", value: "fit" })}>
                      <CornersOutIcon aria-hidden="true" size={12} /><span>适应</span>
                    </button>
                    <button type="button" aria-pressed={zoom === "actual"} onClick={() => dispatchReviewState({ type: "set-zoom-mode", value: "actual" })}>100%</button>
                  </div>
                </div>
              </div>
            </div>
            <button
              className={styles.canvasToolbarHandle}
              type="button"
              aria-expanded={toolbarPinned}
              aria-label={toolbarPinned ? "收起审阅工具" : "显示并固定审阅工具"}
              onClick={() => setToolbarPinned((current) => !current)}
            >
              {toolbarPinned
                ? <CaretUpIcon aria-hidden="true" size={12} weight="bold" />
                : <CaretDownIcon aria-hidden="true" size={12} weight="bold" />}
              <span>审阅工具</span>
            </button>
          </div>

          <div className={styles.canvasReviewBody}>
            {!navigableChanges.length ? (
              <div className={styles.emptyFilterNotice} role="status">
                {filter === "all"
                  ? "本轮没有检测到变化，仍可查看双页"
                  : `本轮没有检测到${FILTER_LABELS[filter]}变化，仍可切回双页或其他类型继续审阅`}
              </div>
            ) : null}
            <div className={styles.canvasGrid} data-view={canvasView}>
              <ReviewDocumentPane
                side="before"
                html={documents.before}
                label={beforeLabel}
                zoom={zoom}
                onFrame={registerFrame}
                onScale={updateScale}
                onViewport={registerViewport}
                onHorizontalScroll={handleHorizontalScroll}
                independentTransport={independentTransport}
                frameUrl={desktopSessions?.before.url}
                loadFailed={reviewLoadFailed}
                visible={canvasView === "split" || canvasView === "before"}
                commentGroups={documents.commentGroups}
                commentLayouts={reviewCommentLayouts}
              />
              <ReviewDocumentPane
                side="after"
                html={documents.after}
                label={afterLabel}
                zoom={zoom}
                onFrame={registerFrame}
                onScale={updateScale}
                onViewport={registerViewport}
                onHorizontalScroll={handleHorizontalScroll}
                independentTransport={independentTransport}
                frameUrl={desktopSessions?.after.url}
                loadFailed={reviewLoadFailed}
                visible={canvasView === "split" || canvasView === "after"}
                commentGroups={[]}
                commentLayouts={[]}
              />
            </div>

            <aside
              ref={mapDrawerRef}
              className={styles.mapDrawer}
              data-open={mapOpen ? "true" : undefined}
              data-pinned={mapPinned ? "true" : undefined}
              aria-label="页面内容地图"
              onMouseLeave={() => { if (!mapPinned) setMapPeeked(false); }}
            >
              <div className={styles.mapHandle}>
                <button
                  className={styles.mapHandleMain}
                  type="button"
                  aria-expanded={mapOpen}
                  aria-label={mapOpen ? "收起内容地图" : "打开内容地图"}
                  onClick={() => {
                    setMapPinned((current) => !current);
                    setMapPeeked(false);
                  }}
                >
                  <SidebarSimpleIcon aria-hidden="true" size={17} weight="duotone" />
                  <span>内容地图</span>
                </button>
                <div className={styles.mapNavigator} aria-label="逐处查看变化">
                  <button type="button" aria-label="上一处变化" disabled={!navigableChanges.length} onClick={() => navigate(-1)}><CaretUpIcon aria-hidden="true" size={11} weight="bold" /></button>
                  <span><strong>{activeIndex >= 0 ? activeIndex + 1 : 0}</strong><small>/{navigableChanges.length}</small></span>
                  <button type="button" aria-label="下一处变化" disabled={!navigableChanges.length} onClick={() => navigate(1)}><CaretDownIcon aria-hidden="true" size={11} weight="bold" /></button>
                </div>
              </div>
              <div className={styles.mapPanel} aria-hidden={!mapOpen} inert={!mapOpen ? true : undefined}>
                <header>
                  <div><span>页面内容地图 · {reviewOutline.length} 个区域</span><strong>{activeChange ? `正在看：${activeChange.label}` : focus === "all" ? "整页总览" : "正在看未修改区域"}</strong></div>
                  <button type="button" aria-label={mapPinned ? "收起内容地图" : "保持内容地图展开"} aria-pressed={mapPinned} onClick={() => setMapPinned((current) => !current)}>
                    <PushPinIcon aria-hidden="true" size={15} weight={mapPinned ? "fill" : "duotone"} />
                  </button>
                </header>
                <button
                  className={styles.mapOverview}
                  type="button"
                  aria-pressed={focus === "all"}
                  onClick={selectPageOverview}
                >
                  <EyeIcon aria-hidden="true" size={15} weight="duotone" />
                  <span><strong>完整页面</strong><small>查看修改前与修改后</small></span>
                </button>
                <div className={styles.mapGroups}>
                  {outlineGroups.map((group) => {
                    const matchingCount = group.items.filter((item) => (
                      Boolean(item.changeId)
                      && (filter === "all" || item.types.includes(filter))
                    )).length;
                    return (
                    <section className={styles.mapGroup} key={group.label}>
                      <h3><span>{group.label}</span><small>{matchingCount}/{group.items.length} 处匹配</small></h3>
                      <ol className={styles.mapList}>
                        {group.items.map((item) => {
                          const itemIndex = reviewOutline.findIndex((candidate) => candidate.id === item.id);
                          const selected = focus === (item.changeId || item.id);
                          const matchesFilter = Boolean(item.changeId)
                            && (filter === "all" || item.types.includes(filter));
                          const panelActive = Boolean(
                            item.panelPath?.length
                            && item.panelPath.every((key, index) => (
                              pagePresentationPath[index] === key
                            )),
                          );
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                data-testid="review-outline-item"
                                data-changed={item.changeId ? "true" : "false"}
                                data-matches-filter={matchesFilter ? "true" : "false"}
                                data-panel-active={panelActive ? "true" : undefined}
                                aria-pressed={selected}
                                aria-label={`${item.label}：${item.helper}`}
                                onClick={() => selectOutlineItem(item)}
                              >
                                <span>{itemIndex + 1}</span>
                                <span><strong>{item.label}</strong><small>{item.helper}</small></span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                    );
                  })}
                </div>
              </div>
            </aside>
            <div className={styles.mapEdgeTrigger} aria-hidden="true" onMouseEnter={() => { if (!mapPinned) setMapPeeked(true); }} />
          </div>
        </section>
      </main>

      <span className={styles.srAnnouncement} aria-live="polite">
        {focus === "all"
          ? `${PAGE_VIEW_LABELS[canvasView]}，${FILTER_LABELS[filter]}`
          : `${PAGE_VIEW_LABELS[canvasView]}，${FILTER_LABELS[filter]}，已定位${activeChange?.label || "页面区域"}`}
      </span>

      {confirmationAction ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirmation();
          }}
        >
          <section
            ref={confirmDialogRef}
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-confirm-title"
            aria-describedby="review-confirm-description"
            onKeyDown={handleConfirmDialogKeyDown}
          >
            <div className={styles.confirmIcon}>
              {confirmationAction === "return"
                ? <ClockCounterClockwiseIcon aria-hidden="true" size={25} weight="duotone" />
                : <CheckCircleIcon aria-hidden="true" size={25} weight="duotone" />}
            </div>
            <h2 id="review-confirm-title">
              {confirmationAction === "return"
                ? `返回 AI 修改前（${beforeLabel}）？`
                : `打开 AI 修改后（${afterLabel}）？`}
            </h2>
            <div className={styles.confirmDescription} id="review-confirm-description">
              {confirmationAction === "return"
                ? <>
                    <span>确认后不会采用这次 AI 返回的 {afterLabel}。</span>
                    <span>将继续使用 {beforeLabel}（AI 修改前）为基线重新修改。</span>
                    <button type="button" onClick={onRevealCandidateHtml}>AI 返回的 HTML 已自动保留，点击在 Finder 中显示。</button>
                  </>
                : <>
                    <span>确认后将切换到 AI 修改后的{afterLabel}。</span>
                    <span>修改前的 {beforeLabel} 与本轮记录仍会保留，可在历史记录中查看。</span>
                  </>}
            </div>
            <div>
              {confirmationAction === "return" ? <>
                <button className={styles.dialogSecondary} type="button" onClick={confirmAndContinue}>返回修改前版本</button>
                <button ref={continueReviewButtonRef} className={styles.dialogPrimary} type="button" onClick={closeConfirmation}>继续审阅</button>
              </> : <>
                <button ref={continueReviewButtonRef} className={styles.dialogSecondary} type="button" onClick={closeConfirmation}>继续审阅</button>
                <button className={styles.dialogPrimary} type="button" onClick={confirmAndContinue}>确认并打开</button>
              </>}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
