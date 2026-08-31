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
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
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
import { TextTIcon } from "@phosphor-icons/react/dist/csr/TextT";
import { TreeStructureIcon } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";

import {
  REVIEW_STRUCTURE_TONE_COLOR,
  type ReviewCommentGroup,
  type ReviewDocuments,
  type ReviewSide,
} from "./review-document";
import ReadOnlyCommentMarker from "../components/ReadOnlyCommentMarker";
import {
  REVIEW_TEXT_EVIDENCE_ADDED_COLOR,
  REVIEW_TEXT_EVIDENCE_REMOVED_COLOR,
} from "../lib/review-text-evidence-marks.js";
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
  reloadRevision: number;
  sessions: ReviewDesktopSessions | null;
  failed: boolean;
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
  all: "全部",
  text: "文字",
  structure: "元素",
};

// Legend dots reuse the canvas diff tones so the toolbar explains the marks
// users already see on the pages: removed/added text and element changes.
const FILTER_TONE_COLORS: Record<ReviewChangeFilter, string[]> = {
  all: [],
  text: [REVIEW_TEXT_EVIDENCE_REMOVED_COLOR, REVIEW_TEXT_EVIDENCE_ADDED_COLOR],
  structure: [REVIEW_STRUCTURE_TONE_COLOR],
};

const PAGE_VIEW_LABELS: Record<ReviewPageView, string> = {
  split: "双页",
  before: "左页 · 修改前",
  after: "右页 · AI 修改后",
};

const subscribeHydration = () => () => {};

type ReviewMessage = {
  source?: string;
  sessionId?: string;
  side?: ReviewSide;
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
  behavior?: ScrollBehavior;
  right?: number;
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
  onScale,
  onViewport,
  onHorizontalScroll,
  independentTransport,
  frameUrl,
  loadFailed,
  visible,
  commentGroups,
  commentLayouts,
  reloadRevision,
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
  reloadRevision: number;
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
            key={`${side}-${reloadRevision}-${independentTransport ? frameUrl || "pending" : "srcdoc"}`}
            data-reload-revision={reloadRevision}
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
  reloadRevision = 0,
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
  /** Re-mounts both comparison frames without creating a second review state. */
  reloadRevision?: number;
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
  const [toolbarPinned, setToolbarPinned] = useState(true);
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);
  const [desktopSessionResult, setDesktopSessionResult] =
    useState<ReviewDesktopSessionResult | null>(null);
  const [commentLayoutState, setCommentLayoutState] = useState<{
    documents: ReviewDocuments;
    reloadRevision: number;
    layouts: ReviewCommentLayout[];
  }>({ documents, reloadRevision, layouts: [] });
  const continueReviewButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const reviewInitializationRef = useRef<{
    documents: ReviewDocuments;
    sessionId: string;
    targetId: string;
    located: boolean;
  } | null>(null);
  const [framesReadyFor, setFramesReadyFor] = useState<{
    documents: ReviewDocuments;
    sessionId: string;
  } | null>(null);
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
  const horizontalFocusSidesRef = useRef(new Set<ReviewSide>());
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
  const reviewFrameReadyRef = useRef<Record<ReviewSide, {
    documents: ReviewDocuments;
    frame: HTMLIFrameElement;
  } | null>>({
    before: null,
    after: null,
  });
  const reviewCommentPortRef = useRef<MessagePort | null>(null);
  const reviewCommentChannelChallengeRef = useRef<{
    challenge: string;
    frame: HTMLIFrameElement;
  } | null>(null);
  const reviewStateRef = useRef({ filter, focus, transparency, pagePresentationPath });
  const scrollModeRef = useRef(scrollMode);
  useLayoutEffect(() => {
    reviewStateRef.current = { filter, focus, transparency, pagePresentationPath };
  }, [filter, focus, pagePresentationPath, transparency]);
  const desktopSessions = desktopSessionResult?.documents === documents
    && desktopSessionResult.reloadRevision === reloadRevision
    ? desktopSessionResult.sessions
    : null;
  const reviewLoadFailed = desktopSessionResult?.documents === documents
    && desktopSessionResult.reloadRevision === reloadRevision
    ? desktopSessionResult.failed
    : false;
  const reviewCommentLayouts = commentLayoutState.documents === documents
    && commentLayoutState.reloadRevision === reloadRevision
    ? commentLayoutState.layouts
    : [];
  const reviewChanges = documents.changes;
  const reviewOutline = documents.outline;
  const navigableChanges = useMemo(() => (
    filter === "all"
      ? reviewChanges
      : reviewChanges.filter((change) => change.types.includes(filter))
  ), [filter, reviewChanges]);
  const activeChange = focus === "all"
    ? null
    : reviewChanges.find((change) => change.id === focus) || null;
  const closeReviewCommentChannel = useCallback(() => {
    const port = reviewCommentPortRef.current;
    if (port) {
      port.onmessage = null;
      port.close();
    }
    reviewCommentPortRef.current = null;
    reviewCommentChannelChallengeRef.current = null;
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

  const focusHorizontalFootprint = useCallback((
    side: ReviewSide,
    left: number,
    right: number,
    mirrorFollower: boolean,
  ) => {
    if (
      !Number.isFinite(left)
      || !Number.isFinite(right)
      || left < 0
      || right < left
      || right > MAX_REVIEW_COMMENT_COORDINATE
    ) return;
    const viewport = viewportsRef.current[side];
    if (!viewport) return;
    const scale = scalesRef.current[side];
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const center = ((left + right) / 2) * scale;
    const target = Math.max(0, Math.min(maximum, center - viewport.clientWidth / 2));
    horizontalFocusSidesRef.current.add(side);
    viewport.scrollLeft = target;
    const focusedSides: ReviewSide[] = [side];
    if (mirrorFollower && scrollModeRef.current === "linked") {
      const followerSide: ReviewSide = side === "before" ? "after" : "before";
      const follower = viewportsRef.current[followerSide];
      if (follower) {
        const followerMaximum = Math.max(0, follower.scrollWidth - follower.clientWidth);
        const normalized = maximum > 0 ? target / maximum : 0;
        horizontalFocusSidesRef.current.add(followerSide);
        follower.scrollLeft = normalized * followerMaximum;
        focusedSides.push(followerSide);
      }
    }
    window.requestAnimationFrame(() => focusedSides.forEach((focusedSide) => {
      horizontalFocusSidesRef.current.delete(focusedSide);
    }));
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

  useLayoutEffect(() => {
    const targetId = documents.changes[0]?.id || "all";
    reviewInitializationRef.current = {
      documents,
      sessionId,
      targetId,
      located: targetId === "all",
    };
    reviewStateRef.current = {
      ...reviewStateRef.current,
      focus: targetId,
      pagePresentationPath: [],
    };
    dispatchReviewState({
      type: "set-navigation-target",
      value: targetId,
    });
    dispatchReviewState({ type: "set-page-presentation", value: [] });
  }, [documents, sessionId]);

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

  const prepareReviewCommentFrame = useCallback((
    side: ReviewSide,
    frame: HTMLIFrameElement,
  ) => {
    const pendingChallenge = reviewCommentChannelChallengeRef.current;
    if (
      side !== "before"
      || !documents.commentTargets.length
      || reviewCommentPortRef.current
      || pendingChallenge?.frame === frame
      || frame.dataset.reloadRevision !== String(reloadRevision)
    ) return;
    // A keyed Review reload may let the retiring iframe report ready just
    // before React registers its replacement. Do not let that old frame's
    // unanswered capability challenge exhaust the new generation.
    reviewCommentChannelChallengeRef.current = null;
    const challenge = createReviewCapabilityChallenge();
    if (!challenge) return;
    reviewCommentChannelChallengeRef.current = { challenge, frame };
    postToFrame(frame, sessionId, {
      type: "request-review-comment-channel",
      challenge,
    });
  }, [documents.commentTargets, reloadRevision, sessionId]);

  useLayoutEffect(() => {
    reviewFrameReadyRef.current = {
      before: null,
      after: null,
    };
    closeReviewCommentChannel();
    // A manual reload replaces both iframes without replacing the Review
    // documents. The private comment MessagePort belongs to the old before
    // frame, so reset it on every frame generation before allowing the
    // replacement frame to negotiate a new one. Layouts are generation-keyed
    // above, so stale measurements stay hidden without an effect-time update.
    const drainRegisteredFrames = () => {
      (["before", "after"] as ReviewSide[]).forEach((side) => {
        const frame = framesRef.current[side];
        const ready = reviewFrameReadyRef.current[side];
        if (!frame || ready?.documents !== documents || ready.frame !== frame) return;
        prepareReviewCommentFrame(side, frame);
      });
    };
    drainRegisteredFrames();
    return () => {
      closeReviewCommentChannel();
    };
  }, [
    closeReviewCommentChannel,
    documents,
    prepareReviewCommentFrame,
    reloadRevision,
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
        reloadRevision,
        sessions: { before: beforeSession, after: afterSession },
        failed: false,
      });
    }).catch(() => {
      // One side failing leaves the other unusable for a paired comparison, so
      // release it now instead of holding it until the next teardown.
      releaseLiveSessions();
      if (!cancelled) {
        setDesktopSessionResult({
          documents,
          reloadRevision,
          sessions: null,
          failed: true,
        });
      }
    });
    return () => {
      cancelled = true;
      releaseLiveSessions();
    };
  }, [documents, independentTransport, reloadRevision, sourcePath]);

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

  const selectChange = useCallback((
    changeId: string,
    behavior: ScrollBehavior = "smooth",
  ) => {
    const selectedChange = reviewChanges.find((change) => change.id === changeId);
    dispatchReviewState({ type: "set-navigation-target", value: changeId });
    const focusChange = () => {
      (["before", "after"] as ReviewSide[]).forEach((side) => {
        postToFrame(framesRef.current[side], sessionId, {
          type: "focus-change",
          changeId,
          panelKey: selectedChange?.panelKey,
          panelPath: selectedChange?.panelPath,
          behavior,
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
  // nothing had changed. Positioning goes through selectChange so it takes the
  // same path as an explicit marker selection, including the
  // panel coordination a change inside a collapsed tab needs.
  // Initialization belongs to one documents/session pair. A replacement must
  // neither inherit the previous pair's target nor reset this flag when one of
  // its iframe elements is registered again. The first positioning is instant
  // so entering Review does not animate all the way down from the page top;
  // explicit navigation keeps the normal smooth behavior.
  useEffect(() => {
    const initialization = reviewInitializationRef.current;
    if (
      !framesReadyFor
      || framesReadyFor.documents !== documents
      || framesReadyFor.sessionId !== sessionId
      || !initialization
      || initialization.documents !== documents
      || initialization.sessionId !== sessionId
      || initialization.located
      || !reviewChanges.some((change) => change.id === initialization.targetId)
    ) return;
    initialization.located = true;
    selectChange(initialization.targetId, "auto");
  }, [documents, framesReadyFor, reviewChanges, selectChange, sessionId]);

  useLayoutEffect(() => {
    const handleMessage = (event: MessageEvent<ReviewMessage>) => {
      const message = event.data;
      if (
        !message
        || message.source !== "pageroot-ai-review"
        || message.sessionId !== sessionId
        || (message.side !== "before" && message.side !== "after")
        || event.source !== framesRef.current[message.side]?.contentWindow
        || framesRef.current[message.side]?.dataset.reloadRevision
          !== String(reloadRevision)
      ) return;
      if (message.type === "review-comment-channel") {
        const port = event.ports.length === 1 ? event.ports[0] : null;
        const expectedChallenge = reviewCommentChannelChallengeRef.current;
        if (
          message.side !== "before"
          || !port
          || typeof message.challenge !== "string"
          || message.challenge !== expectedChallenge?.challenge
          || framesRef.current.before !== expectedChallenge.frame
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
      if (message.type === "ready") {
        const frame = framesRef.current[message.side];
        if (frame) {
          reviewFrameReadyRef.current[message.side] = { documents, frame };
          prepareReviewCommentFrame(message.side, frame);
          if (
            reviewFrameReadyRef.current.before?.documents === documents
            && reviewFrameReadyRef.current.after?.documents === documents
          ) setFramesReadyFor({ documents, sessionId });
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
      if (message.type === "focus-horizontal-footprint") {
        const changeId = typeof message.changeId === "string" ? message.changeId : "";
        const selectedChange = reviewChanges.find((change) => change.id === changeId);
        if (
          changeId !== reviewStateRef.current.focus
          || !selectedChange
        ) return;
        focusHorizontalFootprint(
          message.side,
          Number(message.left),
          Number(message.right),
          !selectedChange.beforePresent || !selectedChange.afterPresent,
        );
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
        const layouts = safeReviewCommentLayouts(message.commentLayouts, allowedKeys);
        setCommentLayoutState({
          documents,
          reloadRevision,
          layouts,
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
    coordinatePagePresentation,
    documents,
    finishPagePresentation,
    focusHorizontalFootprint,
    prepareReviewCommentFrame,
    relayHorizontalWheel,
    reviewChanges,
    reviewOutline,
    reloadRevision,
    selectChange,
    sendState,
    sessionId,
    updateCommentScrollTransform,
  ]);

  const registerFrame = useCallback((side: ReviewSide, frame: HTMLIFrameElement | null) => {
    if (framesRef.current[side] !== frame) {
      if (side === "before") closeReviewCommentChannel();
      reviewFrameReadyRef.current[side] = null;
      setFramesReadyFor(null);
    }
    framesRef.current[side] = frame;
  }, [closeReviewCommentChannel]);

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
    if (scrollModeRef.current !== "linked" || horizontalFocusSidesRef.current.has(side)) return;
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
    <div
      className={styles.reviewRoot}
      data-embedded={embedded ? "true" : undefined}
      data-reload-revision={reloadRevision}
      data-testid="ai-review-workspace"
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
          />
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
        className={`${styles.reviewMain}${sidebar ? ` ${styles.reviewMainWithSidebar}` : ""}`}
        inert={confirmationAction ? true : undefined}
      >
        <section
          className={styles.canvasReview}
          data-toolbar-open={!embedded && toolbarPinned ? "true" : undefined}
        >
          {!embedded ? <div className={styles.canvasToolbarDock}>
            <div className={styles.canvasToolbar}>
              <div className={styles.canvasReviewTitle}>
                <span className={styles.canvasReviewIcon}><EyeIcon aria-hidden="true" size={20} weight="duotone" /></span>
                <span>
                  <strong>审阅模式</strong>
                  <small>前后版本对比</small>
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
                  data-items="3"
                  role="group"
                  aria-label="变化审阅"
                >
                  {(["all", "text", "structure"] as ReviewChangeFilter[]).map((mode) => (
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
                      <span>{FILTER_LABELS[mode]}</span>
                      {FILTER_TONE_COLORS[mode].length ? (
                        <span className={styles.filterTones} aria-hidden="true">
                          {FILTER_TONE_COLORS[mode].map((color) => (
                            <span key={color} style={{ background: color }} />
                          ))}
                        </span>
                      ) : null}
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
          </div> : null}

          <div className={styles.canvasReviewBody}>
            {documents.reviewImpact ? (
              <section
                className={styles.reviewImpactSummary}
                data-testid="review-impact-summary"
                aria-label="本轮 AI 修改范围"
              >
                <div className={styles.reviewImpactHeading}>
                  <span className={styles.reviewImpactEyebrow}>修改范围提示</span>
                  {documents.reviewImpact.outsideRequestedTargetCount > 0 ? (
                    <WarningCircleIcon aria-hidden="true" size={15} weight="fill" />
                  ) : null}
                </div>
                <div className={styles.reviewImpactStats}>
                  <span><strong>{documents.reviewImpact.requestedTargetCount}</strong> 本轮评论目标</span>
                  <span><strong>{documents.reviewImpact.actualChangedElementCount}</strong> 实际修改元素</span>
                  <span><strong>{documents.reviewImpact.outsideRequestedTargetCount}</strong> 目标之外修改</span>
                </div>
                {documents.reviewImpact.outsideRequestedTargetCount > 0 ? (
                  <div className={styles.reviewImpactWarning} role="status">
                    <span>评论目标之外的修改仍保留为上下文，请从变化审阅入口核对。</span>
                    <button
                      className={styles.reviewImpactLink}
                      type="button"
                      onClick={() => selectReviewMode("all")}
                    >
                      查看超范围修改
                    </button>
                    <div className={styles.reviewImpactIds}>
                      <span>
                        目标之外元素
                        {documents.reviewImpact.truncated ? "（仅展示样例）" : ""}：
                      </span>
                      {documents.reviewImpact.outsideTargetElementIdSample.map((id) => (
                        <code key={id}>{id}</code>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={styles.reviewImpactQuiet}>
                    本轮未发现评论目标之外的源码元素修改。
                  </div>
                )}
              </section>
            ) : null}
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
                reloadRevision={reloadRevision}
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
                reloadRevision={reloadRevision}
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
