"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";

import {
  type ReviewCommentGroup,
  type ReviewDocuments,
  type ReviewSide,
} from "./review-document";
import type {
  ReviewRuntimeSnapshotCaptureResult,
} from "../components/desktop-runtime-snapshot-api";
import ReadOnlyCommentMarker from "../components/ReadOnlyCommentMarker";
import {
  acceptRuntimeVisualSnapshots,
  mergeReviewRuntimeVisualChanges,
} from "../lib/review-runtime-visual.js";
import type {
  ReviewRuntimeVisualMarker,
  ReviewRuntimeVisualVerdicts,
} from "../lib/review-runtime-visual.js";
import {
  classifyReviewRuntimeVisualCandidateKeys,
} from "./review-runtime-capture-adapter";
import {
  acceptedRuntimeVisualEnvelope,
} from "../domain/runtime-visual-contract.js";
import {
  ReviewScrollCoordinator,
  followerReviewScrollLeft,
  relayedReviewScrollLeft,
} from "../lib/review-scroll-sync.js";
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
import { ReviewToolbarControls } from "./review-toolbar-controls";
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
  markers: ReviewRuntimeVisualMarker[];
};
type ReviewRuntimeProjectionChannel = {
  documents: ReviewDocuments;
  frame: HTMLIFrameElement;
  port: MessagePort;
  delivered: boolean;
};
type ReviewRuntimeProjectionChannelRequest = {
  documents: ReviewDocuments;
  frame: HTMLIFrameElement;
  challenge: string;
};
type ReviewRuntimeVisualViewport = Readonly<{ width: number; height: number }>;
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

const subscribeHydration = () => () => {};

type ReviewMessage = {
  source?: string;
  contractVersion?: number;
  sessionId?: string;
  side?: ReviewSide;
  sourceSha256?: string;
  type?: string;
  top?: number;
  left?: number;
  deltaX?: number;
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
  changeId?: string;
};

const MAX_REVIEW_COMMENT_COORDINATE = 10_000_000;
function createReviewCapabilityChallenge(): string | null {
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
  onFrameLoad,
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
  onFrameLoad: (side: ReviewSide, frame: HTMLIFrameElement) => void;
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

  const assignFrame = useCallback((frame: HTMLIFrameElement | null) => {
    iframeRef.current = frame;
    if (frame) onFrame(side, frame);
  }, [onFrame, side]);

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
    // Horizontal scrolling must not re-render the pane, so the rendered side is
    // the unscrolled one; pointer entry and keyboard focus measure the live
    // position instead.
    const visibleLeft = layout.viewportLeft * scale;
    const visibleTop = layout.viewportTop * scale;
    return (
      <ReadOnlyCommentMarker
        key={group.key}
        group={group}
        left={left}
        top={top}
        viewportRef={viewportRef}
        initialPlacement={
          visibleLeft < viewportSize.width * .55 ? "right" : "left"
        }
        initialVertical={
          visibleTop < 96
            ? "below"
            : visibleTop > viewportSize.height - 96
              ? "above"
              : "center"
        }
        testId="review-comment-marker"
        bubbleTestId="review-comment-bubble"
      />
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
        onScroll={() => onHorizontalScroll(side)}
      >
        {loadFailed ? (
          <div className={styles.frameError} role="alert">
            审阅画布未能安全载入，可返回 AI 修改前后重试。
          </div>
        ) : null}
        <div
          className={styles.documentScale}
          style={{ width: renderedWidth, height: viewportSize.height }}
        >
          <iframe
            ref={assignFrame}
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
            onLoad={(event) => {
              if (loadFailed || (independentTransport && !frameUrl)) return;
              const frame = event.currentTarget;
              if (iframeRef.current !== frame) return;
              if (viewportRef.current) viewportRef.current.scrollLeft = 0;
              onFrameLoad(side, frame);
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
  sessionId,
  documents,
  sourcePath,
  accepting,
  error,
  notice,
  onAbout,
  onReturnBefore,
  onAccept,
  onRevealAiTask,
  assistantEntry = null,
  sidebar = null,
  embedded = false,
}: {
  fileName: string;
  beforeLabel: string;
  afterLabel: string;
  sessionId: string;
  documents: ReviewDocuments;
  sourcePath?: string;
  accepting: boolean;
  error?: string;
  notice?: string;
  onAbout: () => void;
  onReturnBefore: () => void;
  onAccept: () => void;
  onRevealAiTask: () => void;
  /** The same top-level AI entry used by Preview, hosted in Review's fixed header. */
  assistantEntry?: ReactNode;
  /**
   * The AI conversation, docked beside the comparison so the thread that led to
   * this candidate stays on screen. Read-only here: the Canvas is a candidate,
   * not the editable page a new modification would use.
  */
  sidebar?: ReactNode;
  /** Uses the Workbench header and mounts only the review content outlet. */
  embedded?: boolean;
}) {
  const fileTitle = fileName.replace(/\.(?:html?|xhtml)$/iu, "") || fileName;
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const independentTransport = hydrated && Boolean(window.htmlAIPreview);
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
  const toolbarHost = embedded && hydrated
    ? document.getElementById("workbench-review-tools-slot")
    : null;
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);
  const [desktopSessionResult, setDesktopSessionResult] =
    useState<ReviewDesktopSessionResult | null>(null);
  const [runtimeVisualResult, setRuntimeVisualResult] =
    useState<ReviewRuntimeVisualResult | null>(null);
  const [runtimeProjectionDelivery, setRuntimeProjectionDelivery] = useState<{
    documents: ReviewDocuments | null;
    sides: ReadonlySet<ReviewSide>;
  }>({ documents: null, sides: new Set<ReviewSide>() });
  const [commentLayoutState, setCommentLayoutState] = useState<{
    documents: ReviewDocuments;
    layouts: ReviewCommentLayout[];
  }>({ documents, layouts: [] });
  const continueReviewButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const reviewInitializedRef = useRef(false);
  const initialFocusRef = useRef(false);
  const [framesReady, setFramesReady] = useState(false);
  const framesRef = useRef<Record<ReviewSide, HTMLIFrameElement | null>>({
    before: null,
    after: null,
  });
  const viewportsRef = useRef<Record<ReviewSide, HTMLDivElement | null>>({
    before: null,
    after: null,
  });
  const scalesRef = useRef<Record<ReviewSide, number>>({ before: 1, after: 1 });
  const horizontalRelayRef = useRef<Record<ReviewSide, { baseline: number; delta: number } | null>>({
    before: null,
    after: null,
  });
  const horizontalRelayFrameRef = useRef(0);
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
  const runtimeVisualOwnerDocumentsRef = useRef<ReviewDocuments | null>(null);
  const runtimeVisualResolutionRef = useRef<ReviewRuntimeVisualResult | null>(null);
  const runtimeVisualViewportRef = useRef<ReviewRuntimeVisualViewport | null>(null);
  const runtimeVisualStaticReadyRef = useRef<{
    documents: ReviewDocuments;
    sides: Set<ReviewSide>;
    started: boolean;
  } | null>(null);
  const reviewFrameReadyRef = useRef<Record<ReviewSide, {
    documents: ReviewDocuments;
    frame: HTMLIFrameElement;
  } | null>>({
    before: null,
    after: null,
  });
  const reviewCommentPortRef = useRef<MessagePort | null>(null);
  const reviewCommentChannelChallengeRef = useRef<string | null>(null);
  const runtimeProjectionChannelRef = useRef<Record<
    ReviewSide,
    ReviewRuntimeProjectionChannel | null
  >>({ before: null, after: null });
  const runtimeProjectionChannelRequestRef = useRef<Record<
    ReviewSide,
    ReviewRuntimeProjectionChannelRequest | null
  >>({ before: null, after: null });
  const runtimeProjectionLoadedFrameRef = useRef<Record<
    ReviewSide,
    HTMLIFrameElement | null
  >>({ before: null, after: null });
  const reviewStateRef = useRef({ filter, focus, transparency, pagePresentationPath });
  const scrollModeRef = useRef(scrollMode);
  useLayoutEffect(() => {
    reviewStateRef.current = { filter, focus, transparency, pagePresentationPath };
  }, [filter, focus, pagePresentationPath, transparency]);
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
  /*
   * Stepping through changes one at a time is its own capability, independent of the
   * content map it used to sit beside. Removing the map took this with it, which left
   * the reviewer with no way to walk the changes in order.
   */
  const activeIndex = activeChange
    ? navigableChanges.findIndex((change) => change.id === activeChange.id)
    : -1;

  const closeReviewCommentChannel = useCallback(() => {
    const port = reviewCommentPortRef.current;
    if (port) {
      port.onmessage = null;
      port.close();
    }
    reviewCommentPortRef.current = null;
    reviewCommentChannelChallengeRef.current = null;
  }, []);

  const closeRuntimeProjectionChannel = useCallback((side?: ReviewSide) => {
    const sides: ReviewSide[] = side ? [side] : ["before", "after"];
    sides.forEach((targetSide) => {
      runtimeProjectionChannelRef.current[targetSide]?.port.close();
      runtimeProjectionChannelRef.current[targetSide] = null;
      runtimeProjectionChannelRequestRef.current[targetSide] = null;
    });
  }, []);

  const clearRuntimeProjectionDelivery = useCallback((side: ReviewSide) => {
    setRuntimeProjectionDelivery((current) => {
      if (!current.sides.has(side)) return current;
      const sides = new Set(current.sides);
      sides.delete(side);
      return { documents: current.documents, sides };
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

  // The pane viewport owns horizontal review scrolling, but the wheel lands
  // inside the frame, where a mixed gesture latches onto the vertically
  // scrollable document and drops its horizontal component. Apply the relayed
  // remainder once per frame, after native scroll events for that frame have
  // been delivered, so a gesture the browser did chain out is not doubled.
  const relayHorizontalWheel = useCallback((side: ReviewSide, delta: number) => {
    const viewport = viewportsRef.current[side];
    if (!viewport || !Number.isFinite(delta) || !delta) return;
    const pending = horizontalRelayRef.current[side];
    horizontalRelayRef.current[side] = pending
      ? { baseline: pending.baseline, delta: pending.delta + delta }
      : { baseline: viewport.scrollLeft, delta };
    if (horizontalRelayFrameRef.current) return;
    horizontalRelayFrameRef.current = window.requestAnimationFrame(() => {
      horizontalRelayFrameRef.current = 0;
      (["before", "after"] as ReviewSide[]).forEach((relaySide) => {
        const relay = horizontalRelayRef.current[relaySide];
        horizontalRelayRef.current[relaySide] = null;
        const target = viewportsRef.current[relaySide];
        if (!relay || !target) return;
        const next = relayedReviewScrollLeft({
          baseline: relay.baseline,
          current: target.scrollLeft,
          delta: relay.delta,
          maximum: target.scrollWidth - target.clientWidth,
        });
        if (next !== null) target.scrollLeft = next;
      });
    });
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
    if (!hydrated || !documents.changes[0]) return;
    if (reviewInitializedRef.current && reviewStateRef.current.focus !== "all") return;
    reviewInitializedRef.current = true;
    dispatchReviewState({
      type: "set-navigation-target",
      value: documents.changes[0].id,
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

  const sendState = useCallback((side?: ReviewSide) => {
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
  }, [sessionId]);

  const commitRuntimeVisualFrame = useCallback((
    side: ReviewSide,
    result: ReviewRuntimeVisualResult,
  ) => {
    const channel = runtimeProjectionChannelRef.current[side];
    if (
      channel?.documents === result.documents
      && channel.frame === framesRef.current[side]
      && !channel.delivered
    ) {
      channel.delivered = true;
      channel.port.postMessage({
        source: "pageroot-ai-review-runtime-projection",
        contractVersion: result.documents.runtimeVisualCaptureIdentity.contractVersion,
        sessionId: result.documents.runtimeVisualCaptureIdentity.sessionId,
        side,
        sourceSha256: result.documents.runtimeVisualCaptureIdentity.sourceSha256BySide[side],
        type: "runtime-projection-facts",
        markers: result.markers,
      });
      channel.port.close();
      setRuntimeProjectionDelivery((current) => {
        const sides = current.documents === result.documents
          ? new Set(current.sides)
          : new Set<ReviewSide>();
        if (sides.has(side)) return current;
        sides.add(side);
        return { documents: result.documents, sides };
      });
    }
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

  const resolveRuntimeVisuals = useCallback((verdicts: ReviewRuntimeVisualVerdicts) => {
    if (runtimeVisualResolutionRef.current?.documents === documents) return;
    const merged = mergeReviewRuntimeVisualChanges(documents, verdicts);
    const result: ReviewRuntimeVisualResult = {
      documents,
      changes: [...merged.changes],
      outline: [...merged.outline],
      markers: [...merged.markers],
    };
    runtimeVisualResolutionRef.current = result;
    setRuntimeVisualResult(result);
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      commitRuntimeVisualFrame(side, result);
    });
  }, [commitRuntimeVisualFrame, documents]);

  const prepareReviewCommentFrame = useCallback((
    side: ReviewSide,
    frame: HTMLIFrameElement,
  ) => {
    if (
      side !== "before"
      || !documents.commentTargets.length
      || reviewCommentPortRef.current
      || reviewCommentChannelChallengeRef.current
    ) return;
    const challenge = createReviewCapabilityChallenge();
    if (!challenge) return;
    reviewCommentChannelChallengeRef.current = challenge;
    postToFrame(frame, sessionId, {
      type: "request-review-comment-channel",
      challenge,
    });
  }, [documents.commentTargets, sessionId]);

  const prepareRuntimeVisualFrame = useCallback((
    side: ReviewSide,
    frame: HTMLIFrameElement,
  ) => {
    if (
      runtimeVisualOwnerDocumentsRef.current !== documents
      || !documents.runtimeVisualCandidates.length
      || runtimeProjectionChannelRef.current[side]
      || runtimeProjectionChannelRequestRef.current[side]
    ) return;
    const challenge = createReviewCapabilityChallenge();
    if (!challenge) return;
    runtimeProjectionChannelRequestRef.current[side] = {
      documents,
      frame,
      challenge,
    };
    const captureIdentity = documents.runtimeVisualCaptureIdentity;
    postToFrame(frame, sessionId, {
      contractVersion: captureIdentity.contractVersion,
      side,
      sourceSha256: captureIdentity.sourceSha256BySide[side],
      type: "request-runtime-projection-channel",
      challenge,
    });
    const resolved = runtimeVisualResolutionRef.current;
    if (resolved?.documents === documents) {
      commitRuntimeVisualFrame(side, resolved);
    }
  }, [commitRuntimeVisualFrame, documents, sessionId]);

  const handleRuntimeProjectionFrameLoad = useCallback((
    side: ReviewSide,
    frame: HTMLIFrameElement,
  ) => {
    if (framesRef.current[side] !== frame) return;
    // The first child ready message may race this first top-level load. Both
    // paths may prepare the same guarded request, but only a later load on the
    // same iframe Element represents a new browsing-context lifecycle whose
    // old transferred port must be closed.
    if (runtimeProjectionLoadedFrameRef.current[side] === frame) {
      clearRuntimeProjectionDelivery(side);
      closeRuntimeProjectionChannel(side);
    } else {
      runtimeProjectionLoadedFrameRef.current[side] = frame;
    }
    prepareRuntimeVisualFrame(side, frame);
  }, [clearRuntimeProjectionDelivery, closeRuntimeProjectionChannel, prepareRuntimeVisualFrame]);

  const requestOwnerRuntimeVisualCapture = useCallback(() => {
    if (
      runtimeVisualOwnerDocumentsRef.current !== documents
      || runtimeVisualResolutionRef.current?.documents === documents
    ) return;
    const candidateKeys = new Set(documents.runtimeVisualCandidates.map(({ key }) => key));
    // Without pixel evidence nothing may dim as "verified unchanged": every
    // candidate falls back to the honest suspected presentation instead.
    const allUnverified = (): ReviewRuntimeVisualVerdicts => Object.freeze({
      changedKeys: Object.freeze([]),
      unverifiedKeys: Object.freeze(
        documents.runtimeVisualCandidates.map(({ key }) => key),
      ),
    });
    const captureApi = window.htmlAIReviewRuntimeSnapshots;
    if (!captureApi) {
      resolveRuntimeVisuals(allUnverified());
      return;
    }
    const viewport = runtimeVisualViewportRef.current || Object.freeze({
      width: Math.max(320, Math.min(4_096, Math.round(window.innerWidth || 1_280))),
      height: Math.max(320, Math.min(2_400, Math.round(window.innerHeight || 900))),
    });
    runtimeVisualViewportRef.current = viewport;
    const captureSide = async (side: ReviewSide) => {
      const candidates = documents.runtimeVisualCaptureCandidates[side];
      const expected = {
        sessionId: documents.runtimeVisualCaptureIdentity.sessionId,
        sourceSha256: documents.runtimeVisualCaptureIdentity.sourceSha256BySide[side],
      };
      if (!candidates.length) return [];
      try {
        const capture: ReviewRuntimeSnapshotCaptureResult = await captureApi.capture({
          contractVersion: documents.runtimeVisualCaptureIdentity.contractVersion,
          captureSessionId: expected.sessionId,
          sourceSha256: expected.sourceSha256,
          side,
          html: documents.runtimeVisualSourceHtml[side],
          candidates,
          viewport,
        });
        if (capture?.outcome !== "captured") return [];
        const envelope = acceptedRuntimeVisualEnvelope(capture.envelope, expected);
        return envelope
          ? acceptRuntimeVisualSnapshots(
              capture.envelope.runtimeVisualSnapshots,
              candidateKeys,
            ) || []
          : [];
      } catch {
        return [];
      }
    };
    // Keep the one before/after pair bounded, but do not make two hidden
    // offscreen Electron renderers compete for their short owner deadline.
    void (async () => {
      const before = await captureSide("before");
      const after = await captureSide("after");
      const verdicts = await classifyReviewRuntimeVisualCandidateKeys({
        candidates: documents.runtimeVisualCandidates,
        before,
        after,
      });
      return { verdicts };
    })().then(({ verdicts }) => {
      if (
        runtimeVisualOwnerDocumentsRef.current !== documents
        || runtimeVisualResolutionRef.current?.documents === documents
      ) return;
      resolveRuntimeVisuals(verdicts);
    }).catch(() => {
      if (runtimeVisualOwnerDocumentsRef.current === documents) {
        resolveRuntimeVisuals(allUnverified());
      }
    });
  }, [documents, resolveRuntimeVisuals]);

  useLayoutEffect(() => {
    runtimeVisualOwnerDocumentsRef.current = documents;
    runtimeVisualViewportRef.current = Object.freeze({
      width: Math.max(320, Math.min(4_096, Math.round(window.innerWidth || 1_280))),
      height: Math.max(320, Math.min(2_400, Math.round(window.innerHeight || 900))),
    });
    runtimeVisualStaticReadyRef.current = {
      documents,
      sides: new Set<ReviewSide>(),
      started: false,
    };
    reviewFrameReadyRef.current = {
      before: null,
      after: null,
    };
    runtimeProjectionLoadedFrameRef.current = {
      before: null,
      after: null,
    };
    closeReviewCommentChannel();
    closeRuntimeProjectionChannel();
    runtimeVisualResolutionRef.current = null;
    const drainRegisteredFrames = () => {
      (["before", "after"] as ReviewSide[]).forEach((side) => {
        const frame = framesRef.current[side];
        const ready = reviewFrameReadyRef.current[side];
        if (!frame || ready?.documents !== documents || ready.frame !== frame) return;
        prepareReviewCommentFrame(side, frame);
      });
    };
    if (!documents.runtimeVisualCandidates.length) {
      runtimeVisualResolutionRef.current = {
        documents,
        changes: documents.changes,
        outline: documents.outline,
        markers: [],
      };
      drainRegisteredFrames();
      return () => {
        closeReviewCommentChannel();
        closeRuntimeProjectionChannel();
        if (runtimeVisualOwnerDocumentsRef.current === documents) {
          runtimeVisualOwnerDocumentsRef.current = null;
          runtimeVisualViewportRef.current = null;
        }
        if (runtimeVisualStaticReadyRef.current?.documents === documents) {
          runtimeVisualStaticReadyRef.current = null;
        }
      };
    }
    drainRegisteredFrames();
    return () => {
      closeReviewCommentChannel();
      closeRuntimeProjectionChannel();
      if (runtimeVisualOwnerDocumentsRef.current === documents) {
        runtimeVisualOwnerDocumentsRef.current = null;
        runtimeVisualViewportRef.current = null;
      }
      if (runtimeVisualStaticReadyRef.current?.documents === documents) {
        runtimeVisualStaticReadyRef.current = null;
      }
    };
  }, [
    closeReviewCommentChannel,
    closeRuntimeProjectionChannel,
    documents,
    prepareReviewCommentFrame,
    prepareRuntimeVisualFrame,
    resolveRuntimeVisuals,
  ]);

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
    const liveSessions: ReviewDesktopSession[] = [];
    // A session can resolve after this effect is torn down, and a snapshot taken
    // by the cleanup is still empty while the creates are in flight. Revoking on
    // arrival is what keeps a superseded review from leaking a live session.
    const adopt = (session: ReviewDesktopSession) => {
      if (cancelled) {
        void previewApi.revokeSession(session.sessionId);
        return session;
      }
      liveSessions.push(session);
      return session;
    };
    const releaseLiveSessions = () => {
      while (liveSessions.length) {
        const session = liveSessions.pop();
        if (session) void previewApi.revokeSession(session.sessionId);
      }
    };
    // The two sides are independent, and each create resolves a preview source
    // root and walks the declared assets of a complete document. Creating them
    // together removes one full document scan from the review entry path.
    void Promise.all([
      previewApi.createSession({
        html: documents.before,
        bootstrapJavaScript: documents.bootstrapJavaScript.before,
        bootstrapFallbackJavaScript: documents.bootstrapFallbackJavaScript.before,
        ...(sourcePath ? { sourcePath } : {}),
      }).then(adopt),
      previewApi.createSession({
        html: documents.after,
        bootstrapJavaScript: documents.bootstrapJavaScript.after,
        bootstrapFallbackJavaScript: documents.bootstrapFallbackJavaScript.after,
        ...(sourcePath ? { sourcePath } : {}),
      }).then(adopt),
    ]).then(([beforeSession, afterSession]) => {
      if (cancelled) return;
      setDesktopSessionResult({
        documents,
        sessions: { before: beforeSession, after: afterSession },
        failed: false,
      });
    }).catch(() => {
      // One side failing leaves the other unusable for a paired comparison, so
      // release it now instead of holding it until the next teardown.
      releaseLiveSessions();
      if (!cancelled) {
        setDesktopSessionResult({ documents, sessions: null, failed: true });
      }
    });
    return () => {
      cancelled = true;
      releaseLiveSessions();
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

  // Selecting the first change on entry only set the navigation target, so the
  // rail and the map both said 「正在看…」 while the two pages stayed at the top
  // showing dimmed context. A reviewer's first impression was therefore that
  // nothing had changed, and they had to press 「下一处变化」 to reach the change
  // the header already claimed they were looking at. Positioning goes through
  // selectChange so it takes exactly the path that button takes, including the
  // panel coordination a change inside a collapsed tab needs.
  // Reading the target from a ref meant this never retried: when the frames
  // become ready before the first change is chosen, the ref still held "all" and
  // a ref change cannot re-run an effect. The target is therefore the state.
  useEffect(() => {
    if (!framesReady || initialFocusRef.current) return;
    if (focus === "all" || !reviewChanges.some((change) => change.id === focus)) return;
    initialFocusRef.current = true;
    selectChange(focus);
  }, [focus, framesReady, reviewChanges, selectChange]);

  useLayoutEffect(() => {
    const handleMessage = (event: MessageEvent<ReviewMessage>) => {
      const message = event.data;
      if (
        !message
        || message.source !== "pageroot-ai-review"
        || message.sessionId !== sessionId
        || (message.side !== "before" && message.side !== "after")
        || event.source !== framesRef.current[message.side]?.contentWindow
      ) return;
      if (message.type === "review-comment-channel") {
        const port = event.ports.length === 1 ? event.ports[0] : null;
        const expectedChallenge = reviewCommentChannelChallengeRef.current;
        if (
          message.side !== "before"
          || !port
          || typeof message.challenge !== "string"
          || message.challenge !== expectedChallenge
          || reviewCommentPortRef.current
        ) {
          port?.close();
          return;
        }
        reviewCommentChannelChallengeRef.current = null;
        reviewCommentPortRef.current = port;
        port.postMessage({
          source: "pageroot-ai-review-comment-targets",
          sessionId,
          side: "before",
          type: "comment-targets",
          reviewCommentTargets: documents.commentTargets,
        });
        return;
      }
      if (message.type === "runtime-projection-channel") {
        const port = event.ports.length === 1 ? event.ports[0] : null;
        const request = runtimeProjectionChannelRequestRef.current[message.side];
        const captureIdentity = documents.runtimeVisualCaptureIdentity;
        if (
          !port
          || request?.documents !== documents
          || request.frame !== framesRef.current[message.side]
          || typeof message.challenge !== "string"
          || message.challenge !== request.challenge
          || message.contractVersion !== captureIdentity.contractVersion
          || message.sourceSha256 !== captureIdentity.sourceSha256BySide[message.side]
          || runtimeProjectionChannelRef.current[message.side]
        ) {
          port?.close();
          return;
        }
        runtimeProjectionChannelRequestRef.current[message.side] = null;
        runtimeProjectionChannelRef.current[message.side] = {
          documents,
          frame: request.frame,
          port,
          delivered: false,
        };
        port.start();
        const resolved = runtimeVisualResolutionRef.current;
        if (resolved?.documents === documents) {
          commitRuntimeVisualFrame(message.side, resolved);
        }
        return;
      }
      if (message.type === "ready") {
        const frame = framesRef.current[message.side];
        if (frame) {
          reviewFrameReadyRef.current[message.side] = { documents, frame };
          prepareReviewCommentFrame(message.side, frame);
          prepareRuntimeVisualFrame(message.side, frame);
          if (
            reviewFrameReadyRef.current.before?.documents === documents
            && reviewFrameReadyRef.current.after?.documents === documents
          ) setFramesReady(true);
        }
        sendState(message.side);
        const owner = scrollCoordinatorRef.current?.snapshot();
        if (owner && frame) {
          postToFrame(frame, sessionId, {
            type: "scroll-owner",
            linked: owner.linked,
            leader: owner.leader,
            gestureId: owner.gestureId,
          });
        }
        const staticReady = runtimeVisualStaticReadyRef.current;
        if (staticReady?.documents === documents) {
          staticReady.sides.add(message.side);
          if (staticReady.sides.size === 2 && !staticReady.started) {
            staticReady.started = true;
            requestOwnerRuntimeVisualCapture();
          }
        }
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
      if (message.type === "wheel-horizontal") {
        relayHorizontalWheel(message.side, Number(message.deltaX || 0));
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
      // A click on a page-edge revision bar or a region caption asks the
      // parent to focus that change; the id must name a known change.
      if (message.type === "select-change") {
        const changeId = typeof message.changeId === "string" ? message.changeId : "";
        if (changeId && reviewChanges.some((change) => change.id === changeId)) {
          selectChange(changeId);
        }
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
    prepareReviewCommentFrame,
    prepareRuntimeVisualFrame,
    relayHorizontalWheel,
    requestOwnerRuntimeVisualCapture,
    reviewChanges,
    reviewOutline,
    selectChange,
    sendState,
    sessionId,
    updateCommentScrollTransform,
  ]);

  const registerFrame = useCallback((side: ReviewSide, frame: HTMLIFrameElement | null) => {
    if (framesRef.current[side] !== frame) {
      reviewFrameReadyRef.current[side] = null;
      setFramesReady(false);
      initialFocusRef.current = false;
      runtimeProjectionLoadedFrameRef.current[side] = null;
      clearRuntimeProjectionDelivery(side);
      closeRuntimeProjectionChannel(side);
    }
    framesRef.current[side] = frame;
  }, [clearRuntimeProjectionDelivery, closeRuntimeProjectionChannel]);

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
    if (scrollModeRef.current !== "linked") return;
    const source = viewportsRef.current[side];
    const followerSide: ReviewSide = side === "before" ? "after" : "before";
    const follower = viewportsRef.current[followerSide];
    if (!source || !follower) return;
    const target = followerReviewScrollLeft({
      sourceLeft: source.scrollLeft,
      sourceMaximum: source.scrollWidth - source.clientWidth,
      followerLeft: follower.scrollLeft,
      followerMaximum: follower.scrollWidth - follower.clientWidth,
    });
    if (target === null) return;
    follower.scrollLeft = target;
  }, []);

  const selectReviewMode = useCallback((mode: ReviewChangeFilter) => {
    dispatchReviewState({ type: "set-change-filter", value: mode });
    const matching = mode === "all"
      ? reviewChanges
      : reviewChanges.filter((change) => change.types.includes(mode));
    if (!matching.length || matching.some((change) => change.id === focus)) return;
    selectChange(matching[0].id);
  }, [focus, reviewChanges, selectChange]);

  const selectPreviewMode = useCallback((mode: ReviewPageView) => {
    dispatchReviewState({ type: "set-page-view", value: mode });
  }, []);




  const navigate = useCallback((direction: -1 | 1) => {
    if (!navigableChanges.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : (direction > 0 ? -1 : 0);
    const nextIndex = (currentIndex + direction + navigableChanges.length)
      % navigableChanges.length;
    selectChange(navigableChanges[nextIndex].id);
  }, [activeIndex, navigableChanges, selectChange]);

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
    <div
      className={styles.reviewRoot}
      data-embedded={embedded ? "true" : undefined}
      data-testid="ai-review-workspace"
      data-review-runtime-visual-state={
        !documents.runtimeVisualCandidates.length
          ? "not-required"
          : activeRuntimeVisualResult
            ? "resolved"
            : "pending"
      }
      data-review-runtime-visual-marker-count={
        activeRuntimeVisualResult?.markers.length
      }
      data-review-runtime-visual-delivery={
        !documents.runtimeVisualCandidates.length
          ? "not-required"
          : runtimeProjectionDelivery.documents === documents
              && runtimeProjectionDelivery.sides.size === 2
            ? "complete"
            : "pending"
      }
    >
      {!embedded ? <WorkbenchHeaderShell
        className={styles.reviewHeader}
        inert={confirmationAction ? true : undefined}
      >
        <div className="window-file">
          <span className="window-file-icon-cluster">
            <button
              className="window-file-icon window-file-about-button"
              type="button"
              aria-label="关于源页"
              title="关于源页"
              onClick={onAbout}
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
          {assistantEntry}
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
            <CheckCircleIcon aria-hidden="true" size={15} weight="fill" />
            {accepting ? "正在采纳并核对…" : "采纳 AI 修改"}
          </button>
        </WorkbenchHeaderActions>
      </WorkbenchHeaderShell> : null}

      {embedded && toolbarHost ? createPortal((
        <>
          <ReviewToolbarControls
            pageView={canvasView}
            changeFilter={filter}
            contextVisibility={transparency}
            scrollMode={scrollMode}
            zoomMode={zoom}
            activeIndex={activeIndex}
            changeCount={navigableChanges.length}
            onPageViewChange={selectPreviewMode}
            onChangeFilter={selectReviewMode}
            onContextVisibilityChange={(value) => dispatchReviewState({
              type: "set-context-visibility",
              value,
            })}
            onScrollModeChange={(value) => dispatchReviewState({
              type: "set-scroll-mode",
              value,
            })}
            onZoomModeChange={(value) => dispatchReviewState({
              type: "set-zoom-mode",
              value,
            })}
            onNavigate={navigate}
            onShowWholePage={() => dispatchReviewState({
              type: "set-navigation-target",
              value: "all",
            })}
          />
          <span className="unified-review-status" role="status">
            {filter === "all"
              ? `${reviewChanges.length} 个变化`
              : `${navigableChanges.length}/${reviewChanges.length} 个变化`}
          </span>
          <button
            className="recent-run-button review-return-button"
            type="button"
            disabled={accepting}
            onClick={(event) => openConfirmation("return", event.currentTarget)}
          >
            <ClockCounterClockwiseIcon aria-hidden="true" size={16} weight="duotone" />
            返回修改前
          </button>
          <button
            className="header-send-button review-accept-button"
            type="button"
            disabled={accepting}
            onClick={(event) => openConfirmation("accept", event.currentTarget)}
          >
            <CheckCircleIcon aria-hidden="true" size={14} weight="fill" />
            {accepting ? "正在采纳…" : "采纳修改"}
          </button>
        </>
      ), toolbarHost) : null}

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
        inert={confirmationAction ? true : undefined}
      >
        <section className={styles.canvasReview}>
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
                onFrameLoad={handleRuntimeProjectionFrameLoad}
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
                onFrameLoad={handleRuntimeProjectionFrameLoad}
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

          </div>
        </section>
        {sidebar ? (
          <aside className={styles.reviewSidebar} aria-label="AI 助手">
            {sidebar}
          </aside>
        ) : null}
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
                : `采纳 AI 修改后（${afterLabel}）？`}
            </h2>
            <div className={styles.confirmDescription} id="review-confirm-description">
              {confirmationAction === "return"
                ? <>
                    <span>确认后不会采用这次 AI 返回的 {afterLabel}。</span>
                    <span>将继续使用 {beforeLabel}（AI 修改前）为基线重新修改。</span>
                    <button type="button" onClick={onRevealAiTask}>AI 返回的 HTML 已自动保留，点击在文件夹中打开。</button>
                  </>
                : <>
                    <span>确认后将采纳 AI 修改后的{afterLabel}为正式版本。</span>
                    <span>修改前的 {beforeLabel} 与本轮记录仍会保留，可在历史记录中查看。</span>
                  </>}
            </div>
            <div>
              {confirmationAction === "return" ? <>
                <button className={styles.dialogSecondary} type="button" onClick={confirmAndContinue}>返回修改前版本</button>
                <button ref={continueReviewButtonRef} className={styles.dialogPrimary} type="button" onClick={closeConfirmation}>继续审阅</button>
              </> : <>
                <button ref={continueReviewButtonRef} className={styles.dialogSecondary} type="button" onClick={closeConfirmation}>继续审阅</button>
                <button className={styles.dialogPrimary} type="button" onClick={confirmAndContinue}>确认并采纳</button>
              </>}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
