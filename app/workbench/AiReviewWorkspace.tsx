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
  type ReviewPresentation,
  type ReviewRevealStep,
  type ReviewSide,
} from "./review-document";
import {
  reviewVisualVerdict,
  type ReviewVisualObservation,
  type ReviewVisualVerdict,
} from "./review/review-visual-model.js";
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
type ReviewVisualPhase = "analyzing" | "complete" | "unverified" | "unsupported";
type ReviewVisualResolution = {
  documents: ReviewDocuments;
  reloadRevision: number;
  generation: number;
  phase: ReviewVisualPhase;
  verdicts: Record<string, ReviewVisualVerdict>;
  unverifiedCount: number;
};

function initialVisualResolution(
  documents: ReviewDocuments,
  reloadRevision: number,
  generation: number,
): ReviewVisualResolution {
  const unsupported = documents.visualBinding.identity === "unsupported";
  return {
    documents,
    reloadRevision,
    generation,
    phase: unsupported
      ? "unsupported"
      : documents.visualEvidence.length
        ? "analyzing"
        : "complete",
    verdicts: {},
    unverifiedCount: unsupported ? documents.changes.length : 0,
  };
}

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
  revealSteps?: ReviewRevealStep[];
  presentationEpoch?: number;
  actionKey?: string;
  actionType?: "click" | "control-state";
  panelControl?: boolean;
  value?: string;
  checked?: boolean;
  commentLayouts?: unknown;
  challenge?: unknown;
  changeId?: string;
  focusGroupId?: string;
  regionId?: string;
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
  onFrameLoad,
  onScale,
  onViewport,
  onHorizontalScroll,
  onCommentActive,
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
  onFrameLoad: (side: ReviewSide, frame: HTMLIFrameElement) => void;
  onScale: (side: ReviewSide, scale: number) => void;
  onViewport: (side: ReviewSide, viewport: HTMLDivElement | null) => void;
  onHorizontalScroll: (side: ReviewSide) => void;
  onCommentActive: (keys: readonly string[], active: boolean) => void;
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
  const commentEntries = commentGroups.flatMap((group) => {
    const layout = commentLayoutsByKey.get(group.key);
    return layout ? [{ group, layout }] : [];
  });
  const nearbyCommentClusters: Array<{
    key: string;
    keys: string[];
    items: ReviewCommentGroup["items"];
    top: number;
    viewportTop: number;
    global: boolean;
  }> = [];
  commentEntries
    .filter(({ layout }) => !layout.global)
    .sort((left, right) => left.layout.top - right.layout.top)
    .forEach(({ group, layout }) => {
      const previous = nearbyCommentClusters.at(-1);
      if (previous && Math.abs(layout.top - previous.top) * scale < 34) {
        previous.key += `-${group.key}`;
        previous.keys.push(group.key);
        previous.items.push(...group.items);
        return;
      }
      nearbyCommentClusters.push({
        key: group.key,
        keys: [group.key],
        items: [...group.items],
        top: layout.top,
        viewportTop: layout.viewportTop,
        global: false,
      });
    });
  const globalEntries = commentEntries.filter(({ layout }) => layout.global);
  if (globalEntries.length) {
    nearbyCommentClusters.unshift({
      key: globalEntries.map(({ group }) => group.key).join("-"),
      keys: globalEntries.map(({ group }) => group.key),
      items: globalEntries.flatMap(({ group }) => group.items),
      top: 20 / scale,
      viewportTop: 20 / scale,
      global: true,
    });
  }

  useEffect(() => {
    onScale(side, scale);
  }, [onScale, scale, side]);

  useEffect(() => () => {
    onFrame(side, null);
    onViewport(side, null);
  }, [onFrame, onViewport, side]);

  const renderCommentMarker = (cluster: (typeof nearbyCommentClusters)[number]) => {
    const left = Math.max(18, viewportSize.width - 18);
    const top = Math.max(18, cluster.top * scale);
    const visibleTop = cluster.viewportTop * scale;
    return (
      <ReadOnlyCommentMarker
        key={cluster.key}
        group={{ key: cluster.key, items: cluster.items }}
        left={left}
        top={top}
        viewportRef={viewportRef}
        initialPlacement="left"
        initialVertical={
          visibleTop < 96
            ? "below"
            : visibleTop > viewportSize.height - 96
              ? "above"
              : "center"
        }
        testId="review-comment-marker"
        bubbleTestId="review-comment-bubble"
        onActiveChange={(active) => onCommentActive(cluster.keys, active)}
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
              onFrameLoad(side, frame);
            }}
          />
        </div>
      </div>
      {nearbyCommentClusters.length ? (
        <div className={styles.reviewCommentLayer}>
          <div className={styles.reviewCommentContentLayer}>
            {nearbyCommentClusters.filter((cluster) => !cluster.global).map(renderCommentMarker)}
          </div>
          {nearbyCommentClusters.filter((cluster) => cluster.global).map(renderCommentMarker)}
        </div>
      ) : null}
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
    activeFocusGroupId,
    pagePresentation,
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
  const reviewVisualPortsRef = useRef<Record<ReviewSide, MessagePort | null>>({ before: null, after: null });
  const reviewVisualChallengesRef = useRef<Partial<Record<ReviewSide, { challenge: string; frame: HTMLIFrameElement }>>>({});
  const reviewVisualObservationsRef = useRef<Partial<Record<ReviewSide, Map<string, ReviewVisualObservation>>>>({});
  const reviewVisualGenerationRef = useRef(0);
  const reviewFrameLoadCountsRef = useRef(new WeakMap<HTMLIFrameElement, number>());
  const reviewVisualTimeoutRef = useRef<number | null>(null);
  const activeCommentKeysRef = useRef(new Set<string>());
  const [, setVisualResolution] = useState<ReviewVisualResolution>(() => (
    initialVisualResolution(documents, reloadRevision, 0)
  ));
  const reviewCommentChannelChallengeRef = useRef<{
    challenge: string;
    frame: HTMLIFrameElement;
  } | null>(null);
  const reviewStateRef = useRef({
    filter,
    focus,
    activeFocusGroupId,
    transparency,
    pagePresentation,
  });
  const scrollModeRef = useRef(scrollMode);
  useLayoutEffect(() => {
    reviewStateRef.current = {
      filter,
      focus,
      activeFocusGroupId,
      transparency,
      pagePresentation,
    };
  }, [activeFocusGroupId, filter, focus, pagePresentation, transparency]);
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
  const confirmedChangeIds = useMemo(
    () => new Set(reviewChanges.map((change) => change.id)),
    [reviewChanges],
  );
  const reviewOutline = useMemo(() => documents.outline.filter((item) => (
    !item.changeId || confirmedChangeIds.has(item.changeId)
  )), [confirmedChangeIds, documents.outline]);
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
  const closeReviewVisualChannels = useCallback(() => {
    (['before', 'after'] as ReviewSide[]).forEach((side) => {
      const port = reviewVisualPortsRef.current[side];
      if (port) {
        port.postMessage({
          type: "comment-highlight",
          sessionId,
          side,
          active: false,
          stableIds: [],
        });
        port.onmessage = null;
        port.close();
      }
      reviewVisualPortsRef.current[side] = null;
    });
    reviewVisualChallengesRef.current = {};
    reviewVisualObservationsRef.current = {};
  }, [sessionId]);

  useLayoutEffect(() => {
    reviewVisualGenerationRef.current += 1;
    const generation = reviewVisualGenerationRef.current;
    closeReviewVisualChannels();
    activeCommentKeysRef.current.clear();
    if (reviewVisualTimeoutRef.current !== null) {
      window.clearTimeout(reviewVisualTimeoutRef.current);
      reviewVisualTimeoutRef.current = null;
    }
    setVisualResolution(initialVisualResolution(documents, reloadRevision, generation));
    if (documents.visualBinding.identity === "supported" && documents.visualEvidence.length) {
      reviewVisualTimeoutRef.current = window.setTimeout(() => {
        if (reviewVisualGenerationRef.current !== generation) return;
        const verdicts = Object.fromEntries(documents.visualEvidence.map((evidence) => (
          [evidence.stableId, "unverified" as const]
        )));
        setVisualResolution({
          documents,
          reloadRevision,
          generation,
          phase: "unverified",
          verdicts,
          unverifiedCount: documents.visualEvidence.length,
        });
      }, 4_000);
    }
    return () => {
      if (reviewVisualTimeoutRef.current !== null) {
        window.clearTimeout(reviewVisualTimeoutRef.current);
        reviewVisualTimeoutRef.current = null;
      }
      closeReviewVisualChannels();
    };
  }, [closeReviewVisualChannels, documents, reloadRevision, sessionId]);

  const observeReviewVisualSide = useCallback((side: ReviewSide) => {
    const port = reviewVisualPortsRef.current[side];
    if (!port) return;
    port.postMessage({
      type: "observe",
      sessionId,
      side,
      sourceHash: documents.visualBinding.sourceHash[side],
      generation: reviewVisualGenerationRef.current,
      candidates: documents.visualEvidence.map((evidence) => ({
        stableId: evidence.stableId,
        positionSensitive: evidence.kinds.includes("moved"),
        present: side === "before" ? evidence.beforePresent : evidence.afterPresent,
      })),
    });
  }, [documents, sessionId]);

  const requestReviewVisualFrame = useCallback((side: ReviewSide, frame: HTMLIFrameElement) => {
    if (reviewVisualPortsRef.current[side] || reviewVisualChallengesRef.current[side]?.frame === frame
      || frame.dataset.reloadRevision !== String(reloadRevision)) return;
    const challenge = createReviewCapabilityChallenge();
    if (!challenge) return;
    reviewVisualChallengesRef.current[side] = { challenge, frame };
    postToFrame(frame, sessionId, { type: "request-review-visual-channel", challenge });
  }, [reloadRevision, sessionId]);

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
    viewport.parentElement?.style.setProperty(
      "--review-comment-scroll-y",
      `${safeTop * scale}px`,
    );
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
    reviewStateRef.current = {
      ...reviewStateRef.current,
      focus: "all",
      activeFocusGroupId: null,
      pagePresentation: { before: [], after: [] },
    };
    dispatchReviewState({
      type: "set-navigation-target",
      value: "all",
    });
    dispatchReviewState({
      type: "set-page-presentation",
      value: { before: [], after: [] },
    });
    dispatchReviewState({ type: "set-active-focus-group", value: null });
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
          activeFocusGroupId: state.activeFocusGroupId,
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

  const handleReviewFrameLoad = useCallback((
    side: ReviewSide,
    frame: HTMLIFrameElement,
  ) => {
    if (framesRef.current[side] !== frame) return;
    const loadCount = reviewFrameLoadCountsRef.current.get(frame) || 0;
    reviewFrameLoadCountsRef.current.set(frame, loadCount + 1);
    if (loadCount === 0) return;
    const generation = reviewVisualGenerationRef.current + 1;
    reviewVisualGenerationRef.current = generation;
    reviewVisualObservationsRef.current = {};
    setVisualResolution(initialVisualResolution(documents, reloadRevision, generation));
    if (reviewVisualTimeoutRef.current !== null) window.clearTimeout(reviewVisualTimeoutRef.current);
    if (documents.visualBinding.identity === "supported" && documents.visualEvidence.length) {
      reviewVisualTimeoutRef.current = window.setTimeout(() => {
        if (reviewVisualGenerationRef.current !== generation) return;
        setVisualResolution({
          documents,
          reloadRevision,
          generation,
          phase: "unverified",
          verdicts: Object.fromEntries(documents.visualEvidence.map((evidence) => (
            [evidence.stableId, "unverified" as const]
          ))),
          unverifiedCount: documents.visualEvidence.length,
        });
      }, 4_000);
    }
    activeCommentKeysRef.current.clear();
    (["before", "after"] as ReviewSide[]).forEach((targetSide) => {
      reviewVisualPortsRef.current[targetSide]?.postMessage({
        type: "comment-highlight",
        sessionId,
        side: targetSide,
        active: false,
        stableIds: [],
      });
      reviewVisualPortsRef.current[targetSide]?.postMessage({
        type: "verdicts",
        sessionId,
        side: targetSide,
        changed: reviewChanges.map((change) => ({
          ...change,
          stableId: change.evidenceStableIds?.[0],
        })),
      });
    });
    const port = reviewVisualPortsRef.current[side];
    if (port) {
      port.onmessage = null;
      port.close();
    }
    reviewVisualPortsRef.current[side] = null;
    delete reviewVisualChallengesRef.current[side];
    if (side === "before") {
      closeReviewCommentChannel();
      setCommentLayoutState({ documents, reloadRevision, layouts: [] });
    }
    const otherSide: ReviewSide = side === "before" ? "after" : "before";
    observeReviewVisualSide(otherSide);
    window.requestAnimationFrame(() => {
      if (framesRef.current[side] !== frame) return;
      prepareReviewCommentFrame(side, frame);
      requestReviewVisualFrame(side, frame);
    });
  }, [
    closeReviewCommentChannel,
    documents,
    observeReviewVisualSide,
    prepareReviewCommentFrame,
    reloadRevision,
    reviewChanges,
    requestReviewVisualFrame,
    sessionId,
  ]);

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
    requested: ReviewPresentation,
    afterCommit?: () => void,
  ) => {
    const normalize = (side: ReviewSide) => {
      const seen = new Set<string>();
      return requested[side].filter((step) => {
        const valid = step.kind === "panel"
          ? /^panel-\d+$/u.test(step.key)
          : /^pr1_[0-9a-f]{32}$/iu.test(step.stableId);
        if (!valid) return false;
        const key = step.kind === "panel" ? `panel:${step.key}` : `details:${step.stableId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const presentation: ReviewPresentation = {
      before: normalize("before"),
      after: normalize("after"),
    };
    if (!presentation.before.length && !presentation.after.length) {
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
    dispatchReviewState({ type: "set-page-presentation", value: presentation });
    expected.forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "begin-presentation",
        presentationEpoch: epoch,
      });
    });
    expected.forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "activate-presentation",
        revealSteps: presentation[side],
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
  }, [activeFocusGroupId, filter, focus, sendState, transparency]);

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
    requestedFocusGroupId?: string,
    activateFocusGroup = true,
    requestedRegionId?: string,
    requestedSide?: ReviewSide,
  ) => {
    const selectedChange = reviewChanges.find((change) => change.id === changeId);
    const changeGroups = documents.focusGroups.filter((group) => group.changeIds.includes(changeId));
    const requestedGroup = requestedFocusGroupId
      ? changeGroups.find((group) => group.id === requestedFocusGroupId) || null
      : null;
    // Explicit region navigation is a capability carried by the formal plan.
    // An unknown group or region must fail closed instead of silently focusing
    // a different group that happens to belong to the same change.
    if (requestedFocusGroupId && !requestedGroup) return;
    if ((requestedRegionId && !requestedSide) || (!requestedRegionId && requestedSide)) return;
    const selectedFocusGroup = requestedGroup || changeGroups[0] || null;
    const selectedRegion = requestedGroup && requestedRegionId && requestedSide
      ? requestedGroup.regions[requestedSide].find((region) => (
        region.id === requestedRegionId
        && region.primaryChangeId === changeId
      )) || null
      : null;
    if (requestedRegionId && !selectedRegion) return;
    const nextActiveFocusGroupId = requestedGroup
      ? activeFocusGroupId === requestedGroup.id ? null : requestedGroup.id
      : changeGroups.length === 1 ? changeGroups[0].id : null;
    reviewStateRef.current = {
      ...reviewStateRef.current,
      focus: changeId,
      ...(activateFocusGroup ? { activeFocusGroupId: nextActiveFocusGroupId } : {}),
    };
    dispatchReviewState({ type: "set-navigation-target", value: changeId });
    if (activateFocusGroup) dispatchReviewState({
        type: "set-active-focus-group",
        value: nextActiveFocusGroupId,
      });
    // Re-selecting the active group is the explicit exit to overview. Keep the
    // current scroll and disclosure state untouched while the overlay state is
    // cleared by the normal state broadcast.
    if (activateFocusGroup && requestedGroup && nextActiveFocusGroupId === null) return;
    const regionForSide = (side: ReviewSide) => {
      if (!selectedFocusGroup) return null;
      if (selectedRegion) {
        if (side === requestedSide) return selectedRegion;
        return selectedFocusGroup.regions[side].find((region) => (
          region.correlationKey === selectedRegion.correlationKey
        )) || null;
      }
      return selectedFocusGroup.regions[side][0] || null;
    };
    const presentation: ReviewPresentation = selectedFocusGroup
      ? {
        before: selectedRegion
          ? regionForSide("before")?.presentation || []
          : regionForSide("before")?.presentation || selectedFocusGroup.presentation.before,
        after: selectedRegion
          ? regionForSide("after")?.presentation || []
          : regionForSide("after")?.presentation || selectedFocusGroup.presentation.after,
      }
      : selectedChange?.presentation || { before: [], after: [] };
    const focusChange = () => {
      (["before", "after"] as ReviewSide[]).forEach((side) => {
        const region = regionForSide(side);
        if (selectedFocusGroup && !region) return;
        postToFrame(framesRef.current[side], sessionId, {
          type: "focus-change",
          changeId: region?.primaryChangeId || changeId,
          focusGroupId: selectedFocusGroup?.id,
          regionId: region?.id,
          revealSteps: presentation[side],
          behavior,
        });
      });
    };
    if (presentation.before.length || presentation.after.length) {
      coordinatePagePresentation(presentation, focusChange);
    } else {
      focusChange();
    }
  }, [activeFocusGroupId, coordinatePagePresentation, documents.focusGroups, reviewChanges, sessionId]);

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
      if (message.type === "review-visual-channel") {
        const port = event.ports.length === 1 ? event.ports[0] : null;
        const visualSide = message.side as ReviewSide;
        const expected = reviewVisualChallengesRef.current[visualSide];
        if (!port || typeof message.challenge !== "string" || message.challenge !== expected?.challenge
          || expected.frame !== framesRef.current[visualSide] || reviewVisualPortsRef.current[visualSide]) {
          port?.close();
          return;
        }
        delete reviewVisualChallengesRef.current[visualSide];
        reviewVisualPortsRef.current[visualSide] = port;
        port.onmessage = (portEvent) => {
          const payload = portEvent.data;
          if (!payload || payload.type !== "observations" || !Array.isArray(payload.observations)) return;
          const observations = new Map<string, ReviewVisualObservation>();
          payload.observations.forEach((value: unknown) => {
            const observation = value as ReviewVisualObservation;
            if (observation?.side === visualSide && typeof observation.stableId === "string") {
              observations.set(observation.stableId, observation);
            }
          });
          reviewVisualObservationsRef.current[visualSide] = observations;
          const before = reviewVisualObservationsRef.current.before;
          const after = reviewVisualObservationsRef.current.after;
          if (!before || !after) return;
          const generation = reviewVisualGenerationRef.current;
          const verdicts = Object.fromEntries(documents.visualEvidence.map((evidence) => (
            [evidence.stableId, reviewVisualVerdict(
              evidence,
              before.get(evidence.stableId),
              after.get(evidence.stableId),
              documents.visualBinding,
              generation,
            )]
          )));
          const unverifiedCount = Object.values(verdicts).filter((verdict) => (
            verdict === "unverified"
          )).length;
          if (reviewVisualTimeoutRef.current !== null) {
            window.clearTimeout(reviewVisualTimeoutRef.current);
            reviewVisualTimeoutRef.current = null;
          }
          setVisualResolution({
            documents,
            reloadRevision,
            generation,
            phase: unverifiedCount ? "unverified" : "complete",
            verdicts,
            unverifiedCount,
          });
        };
        port.postMessage({
          type: "verdicts",
          sessionId,
          side: visualSide,
          changed: reviewChanges.map((change) => ({
            ...change,
            stableId: change.evidenceStableIds?.[0],
          })),
        });
        const activeKeys = activeCommentKeysRef.current;
        const activeStableIds = [...new Set(documents.commentTargets.flatMap((target) => (
          activeKeys.has(target.key) && target.stableId ? [target.stableId] : []
        )))];
        if (activeStableIds.length) port.postMessage({
          type: "comment-highlight",
          sessionId,
          side: visualSide,
          active: true,
          stableIds: activeStableIds,
        });
        if (documents.visualBinding.identity === "supported" && documents.visualEvidence.length) {
          observeReviewVisualSide(visualSide);
        }
        return;
      }
      if (message.type === "ready") {
        const frame = framesRef.current[message.side];
        if (frame) {
          reviewFrameReadyRef.current[message.side] = { documents, frame };
          prepareReviewCommentFrame(message.side, frame);
          requestReviewVisualFrame(message.side, frame);
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
        const focusGroupId = typeof message.focusGroupId === "string" ? message.focusGroupId : "";
        const selectedChange = reviewChanges.find((change) => change.id === changeId);
        const activeGroup = documents.focusGroups.find((group) => (
          group.id === reviewStateRef.current.activeFocusGroupId
        ));
        if (activeGroup) {
          if (activeGroup.id !== focusGroupId || !activeGroup.changeIds.includes(changeId)) return;
          focusHorizontalFootprint(
            message.side,
            Number(message.left),
            Number(message.right),
            false,
          );
          return;
        }
        if (changeId !== reviewStateRef.current.focus || !selectedChange) return;
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
        if (message.type === "action" && reviewStateRef.current.activeFocusGroupId) {
          reviewStateRef.current = {
            ...reviewStateRef.current,
            activeFocusGroupId: null,
          };
          dispatchReviewState({ type: "set-active-focus-group", value: null });
        }
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
        if (reviewStateRef.current.activeFocusGroupId) {
          reviewStateRef.current = {
            ...reviewStateRef.current,
            activeFocusGroupId: null,
          };
          dispatchReviewState({ type: "set-active-focus-group", value: null });
        }
        const panelPath = message.panelPath?.length
          ? message.panelPath
          : message.panelKey
            ? [message.panelKey]
            : [];
        const panelSteps: ReviewRevealStep[] = panelPath.map((key) => ({ kind: "panel", key }));
        const visibleItem = reviewOutline.find((item) => (
          item.presentation?.[message.side || "after"]
            .filter((step) => step.kind === "panel")
            .at(-1)?.key === panelPath.at(-1)
        ));
        if (visibleItem) {
          dispatchReviewState({
            type: "set-navigation-target",
            value: visibleItem.changeId || visibleItem.id,
          });
        }
        coordinatePagePresentation({ before: panelSteps, after: panelSteps });
        return;
      }
      // A click on a page-edge revision bar or a region caption asks the
      // parent to focus that change; the id must name a known change.
      if (message.type === "select-change") {
        const changeId = typeof message.changeId === "string" ? message.changeId : "";
        if (changeId && reviewChanges.some((change) => change.id === changeId)) {
          const focusGroupId = typeof message.focusGroupId === "string"
            ? message.focusGroupId
            : undefined;
          const regionId = typeof message.regionId === "string" ? message.regionId : undefined;
          selectChange(changeId, "smooth", focusGroupId, true, regionId, message.side);
        }
        return;
      }
      if (message.type === "leave-focus" && reviewStateRef.current.activeFocusGroupId) {
        dispatchReviewState({ type: "set-active-focus-group", value: null });
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
    observeReviewVisualSide,
    prepareReviewCommentFrame,
    requestReviewVisualFrame,
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

  const setReviewCommentHighlight = useCallback((
    keys: readonly string[],
    active: boolean,
  ) => {
    keys.forEach((key) => {
      if (active) activeCommentKeysRef.current.add(key);
      else activeCommentKeysRef.current.delete(key);
    });
    const allowedKeys = activeCommentKeysRef.current;
    const stableIds = [...new Set(documents.commentTargets.flatMap((target) => (
      allowedKeys.has(target.key) && target.stableId ? [target.stableId] : []
    )))];
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      reviewVisualPortsRef.current[side]?.postMessage({
        type: "comment-highlight",
        sessionId,
        side,
        active: stableIds.length > 0,
        stableIds,
      });
    });
  }, [documents.commentTargets, sessionId]);

  useEffect(() => {
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      reviewVisualPortsRef.current[side]?.postMessage({
        type: "verdicts",
        sessionId,
        side,
        changed: reviewChanges.map((change) => ({
          ...change,
          stableId: change.evidenceStableIds?.[0],
        })),
      });
    });
  }, [reviewChanges, sessionId]);

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
    const activeFocusGroup = documents.focusGroups.find((group) => (
      group.id === activeFocusGroupId
    ));
    const groupMatches = (group: ReviewDocuments["focusGroups"][number]) => (
      mode === "all"
      || (mode === "text" ? group.kind === "text" : group.kind !== "text")
    );
    if (activeFocusGroup && !groupMatches(activeFocusGroup)) {
      dispatchReviewState({ type: "set-active-focus-group", value: null });
    }
    const matching = mode === "all"
      ? reviewChanges
      : reviewChanges.filter((change) => change.types.includes(mode));
    if (!matching.length || matching.some((change) => change.id === focus)) return;
    selectChange(matching[0].id, "smooth", undefined, false);
  }, [activeFocusGroupId, documents.focusGroups, focus, reviewChanges, selectChange]);

  useEffect(() => {
    if (!activeFocusGroupId) return;
    const activeGroup = documents.focusGroups.find((group) => group.id === activeFocusGroupId);
    const matchesFilter = activeGroup && (
      filter === "all"
      || (filter === "text" ? activeGroup.kind === "text" : activeGroup.kind !== "text")
    );
    if (!matchesFilter) dispatchReviewState({ type: "set-active-focus-group", value: null });
  }, [activeFocusGroupId, documents.focusGroups, filter]);

  useEffect(() => {
    const leaveFocus = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const editableTarget = Boolean(
        target?.closest("input, textarea, select")
        || (target instanceof HTMLElement && target.isContentEditable)
        || activeElement?.closest("input, textarea, select")
        || activeElement?.isContentEditable,
      );
      if (
        event.key !== "Escape"
        || event.defaultPrevented
        || confirmationAction
        || editableTarget
        || !reviewStateRef.current.activeFocusGroupId
      ) return;
      event.preventDefault();
      dispatchReviewState({ type: "set-active-focus-group", value: null });
    };
    window.addEventListener("keydown", leaveFocus);
    return () => window.removeEventListener("keydown", leaveFocus);
  }, [confirmationAction]);

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
            <div className={styles.canvasGrid} data-view={canvasView}>
              <ReviewDocumentPane
                side="before"
                html={documents.before}
                label={beforeLabel}
                zoom={zoom}
                onFrame={registerFrame}
                onFrameLoad={handleReviewFrameLoad}
                onScale={updateScale}
                onViewport={registerViewport}
                onHorizontalScroll={handleHorizontalScroll}
                onCommentActive={setReviewCommentHighlight}
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
                onFrameLoad={handleReviewFrameLoad}
                onScale={updateScale}
                onViewport={registerViewport}
                onHorizontalScroll={handleHorizontalScroll}
                onCommentActive={setReviewCommentHighlight}
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
