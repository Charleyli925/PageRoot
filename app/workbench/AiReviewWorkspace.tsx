"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
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
  type ReviewFilter,
  type ReviewDocuments,
  type ReviewSide,
} from "./review-document";
import {
  WorkbenchHeaderActions,
  WorkbenchHeaderShell,
} from "./workbench-header-shell";
import styles from "./ai-review-workspace.module.css";

type ScrollMode = "linked" | "independent";
type ZoomMode = "fit" | "actual";
type CanvasView = "split" | ReviewSide;
type PreviewDisplayMode = "preview-split" | "preview-before" | "preview-after";
type ChangeDisplayMode = "diff-all" | "diff-text" | "diff-structure" | "diff-style";
type ReviewDisplayMode = PreviewDisplayMode | ChangeDisplayMode;
type ReviewChangeFilter = Exclude<ReviewFilter, "overview">;
type ConfirmationAction = "return" | "accept";
type ReviewDesktopSession = { sessionId: string; url: string };
type ReviewDesktopSessions = Record<ReviewSide, ReviewDesktopSession>;
type ReviewDesktopSessionResult = {
  documents: ReviewDocuments;
  sessions: ReviewDesktopSessions | null;
  failed: boolean;
};

const FILTER_LABELS: Record<ReviewFilter, string> = {
  overview: "整页",
  all: "全部变化",
  text: "文案",
  structure: "结构",
  style: "视觉",
};

const DISPLAY_MODE_PROJECTION: Record<ReviewDisplayMode, {
  canvasView: CanvasView;
  filter: ReviewFilter;
  label: string;
}> = {
  "preview-split": { canvasView: "split", filter: "overview", label: "整页 · 双页预览" },
  "preview-before": { canvasView: "before", filter: "overview", label: "左页 · 修改前" },
  "preview-after": { canvasView: "after", filter: "overview", label: "右页 · AI 修改后" },
  "diff-all": { canvasView: "split", filter: "all", label: "全部变化" },
  "diff-text": { canvasView: "split", filter: "text", label: "文案变化" },
  "diff-structure": { canvasView: "split", filter: "structure", label: "结构变化" },
  "diff-style": { canvasView: "split", filter: "style", label: "视觉变化" },
};

const DISPLAY_MODE_BY_FILTER: Record<ReviewChangeFilter, ChangeDisplayMode> = {
  all: "diff-all",
  text: "diff-text",
  structure: "diff-structure",
  style: "diff-style",
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
  ratio?: number;
  pageRatio?: number;
  outlineId?: string;
};

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
}: {
  side: ReviewSide;
  html: string;
  label: string;
  zoom: ZoomMode;
  onFrame: (side: ReviewSide, frame: HTMLIFrameElement | null) => void;
  onScale: (side: ReviewSide, scale: number) => void;
  onViewport: (side: ReviewSide, viewport: HTMLDivElement | null) => void;
  onHorizontalScroll: (side: ReviewSide) => void;
  independentTransport: boolean;
  frameUrl?: string;
  loadFailed: boolean;
  visible: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 590, height: 620 });
  const targetViewportWidth = 1180;

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

  const scale = zoom === "fit"
    ? Math.min(1, Math.max(.32, viewportSize.width / targetViewportWidth))
    : 1;
  const renderedWidth = targetViewportWidth * scale;
  const iframeHeight = Math.max(620, viewportSize.height / scale);

  useEffect(() => {
    onScale(side, scale);
  }, [onScale, scale, side]);

  useEffect(() => () => {
    onFrame(side, null);
    onViewport(side, null);
  }, [onFrame, onViewport, side]);

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
              width: targetViewportWidth,
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
  sourcePath,
  accepting,
  error,
  notice,
  onExit,
  onReturnBefore,
  onAccept,
}: {
  fileName: string;
  beforeLabel: string;
  afterLabel: string;
  beforeHtml: string;
  afterHtml: string;
  sourcePath?: string;
  accepting: boolean;
  error?: string;
  notice?: string;
  onExit: () => void;
  onReturnBefore: () => void;
  onAccept: () => void;
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
        })
      : {
          before: EMPTY_REVIEW_DOCUMENT,
          after: EMPTY_REVIEW_DOCUMENT,
          bootstrapJavaScript: { before: "", after: "" },
          changes: [],
          outline: [],
        }
  ), [afterHtml, beforeHtml, hydrated, independentTransport, sessionId, sourcePath]);
  const [displayMode, setDisplayMode] = useState<ReviewDisplayMode>("preview-split");
  const [focus, setFocus] = useState("all");
  const [scrollMode, setScrollMode] = useState<ScrollMode>("linked");
  const [zoom, setZoom] = useState<ZoomMode>("actual");
  const [transparency, setTransparency] = useState(22);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const [mapPeeked, setMapPeeked] = useState(false);
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);
  const [desktopSessionResult, setDesktopSessionResult] =
    useState<ReviewDesktopSessionResult | null>(null);
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
  const horizontalSyncingRef = useRef(false);
  const { canvasView, filter } = DISPLAY_MODE_PROJECTION[displayMode];
  const reviewStateRef = useRef({ filter, focus, transparency });
  const desktopSessions = desktopSessionResult?.documents === documents
    ? desktopSessionResult.sessions
    : null;
  const reviewLoadFailed = desktopSessionResult?.documents === documents
    ? desktopSessionResult.failed
    : false;
  const navigableChanges = useMemo(() => (
    filter === "overview" || filter === "all"
      ? documents.changes
      : documents.changes.filter((change) => change.types.includes(filter))
  ), [documents.changes, filter]);
  const activeChange = focus === "all"
    ? null
    : documents.changes.find((change) => change.id === focus) || null;
  const activeIndex = activeChange
    ? navigableChanges.findIndex((change) => change.id === activeChange.id)
    : -1;
  const outlineGroups = useMemo(() => {
    const grouped = new Map<string, ReviewDocuments["outline"]>();
    documents.outline.forEach((item) => {
      const items = grouped.get(item.group) || [];
      items.push(item);
      grouped.set(item.group, items);
    });
    return [...grouped.entries()].map(([label, items]) => ({ label, items }));
  }, [documents.outline]);
  const mapOpen = mapPinned || mapPeeked;

  useEffect(() => {
    reviewStateRef.current = { filter, focus, transparency };
  }, [filter, focus, transparency]);

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
      if (message.type === "ready") {
        sendState(message.side);
        return;
      }
      if (message.type !== "scroll" || scrollMode !== "linked") return;
      const follower: ReviewSide = message.side === "before" ? "after" : "before";
      postToFrame(framesRef.current[follower], sessionId, {
        type: "sync-scroll",
        outlineId: message.outlineId,
        ratio: Number(message.ratio || 0),
        pageRatio: Number(message.pageRatio || 0),
        left: Number(message.left || 0),
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [scrollMode, sendState, sessionId]);

  const registerFrame = useCallback((side: ReviewSide, frame: HTMLIFrameElement | null) => {
    framesRef.current[side] = frame;
    if (frame) window.requestAnimationFrame(() => sendState(side));
  }, [sendState]);

  const registerViewport = useCallback((side: ReviewSide, viewport: HTMLDivElement | null) => {
    viewportsRef.current[side] = viewport;
  }, []);

  const updateScale = useCallback((side: ReviewSide, scale: number) => {
    scalesRef.current[side] = scale;
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
  }, [sessionId]);

  const handleHorizontalScroll = useCallback((side: ReviewSide) => {
    if (scrollMode !== "linked" || horizontalSyncingRef.current) return;
    const source = viewportsRef.current[side];
    const followerSide: ReviewSide = side === "before" ? "after" : "before";
    const follower = viewportsRef.current[followerSide];
    if (!source || !follower) return;
    horizontalSyncingRef.current = true;
    follower.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      horizontalSyncingRef.current = false;
    });
  }, [scrollMode]);

  const selectChange = useCallback((changeId: string, preferredFilter?: ReviewChangeFilter) => {
    const selectedChange = documents.changes.find((change) => change.id === changeId);
    setFocus(changeId);
    const requested = preferredFilter || (filter === "overview" ? "all" : filter);
    const resolvedFilter = selectedChange
      && requested !== "all"
      && !selectedChange.types.includes(requested)
      ? "all"
      : requested;
    setDisplayMode(DISPLAY_MODE_BY_FILTER[resolvedFilter]);
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "focus-change",
        changeId,
        behavior: "smooth",
      });
    });
  }, [documents.changes, filter, sessionId]);

  const selectReviewMode = useCallback((mode: ReviewChangeFilter) => {
    const candidates = mode === "all"
      ? documents.changes
      : documents.changes.filter((change) => change.types.includes(mode));
    const current = candidates.find((change) => change.id === focus);
    const target = current || candidates[0];
    if (!target) {
      setDisplayMode(DISPLAY_MODE_BY_FILTER[mode]);
      setFocus("all");
      return;
    }
    selectChange(target.id, mode);
  }, [documents.changes, focus, selectChange]);

  const selectPreviewMode = useCallback((mode: PreviewDisplayMode) => {
    setDisplayMode(mode);
    setFocus("all");
  }, []);

  const selectOutlineItem = useCallback((item: ReviewDocuments["outline"][number]) => {
    if (item.changeId) {
      selectChange(item.changeId);
      return;
    }
    setDisplayMode("preview-split");
    setFocus(item.id);
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "focus-outline",
        outlineId: item.id,
        behavior: "smooth",
      });
    });
  }, [selectChange, sessionId]);

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
            {accepting ? "正在核对并打开…" : "接受全部并打开"}
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

      <main className={styles.reviewMain} inert={confirmationAction ? true : undefined}>
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
                  <small>{DISPLAY_MODE_PROJECTION[displayMode].label} · {documents.changes.length} 处变化</small>
                </span>
              </div>

              <div className={styles.reviewModeControl}>
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
                    aria-pressed={displayMode === "preview-split"}
                    onClick={() => selectPreviewMode("preview-split")}
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    <BrowsersIcon aria-hidden="true" size={14} weight="duotone" />
                    <span>整页</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`单独查看修改前 ${beforeLabel}`}
                    aria-pressed={displayMode === "preview-before"}
                    onClick={() => selectPreviewMode("preview-before")}
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    <CaretLeftIcon aria-hidden="true" size={14} weight="bold" />
                    <span>左页</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`单独查看 AI 修改后 ${afterLabel}`}
                    aria-pressed={displayMode === "preview-after"}
                    onClick={() => selectPreviewMode("preview-after")}
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    <span>右页</span>
                  </button>
                </div>
              </div>

              <label className={styles.transparencyControl}>
                <span><span>上下文可见度</span><output>{transparency}%</output></span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={transparency}
                  aria-label="非修改区域上下文可见度"
                  title="调整非修改区域；如果当前是整页视图，会先聚焦第一处变化"
                  style={{ "--mask-position": `${transparency}%` } as CSSProperties}
                  onInput={(event) => {
                    setTransparency(Number(event.currentTarget.value));
                    if (focus === "all" && documents.changes[0]) {
                      selectChange(documents.changes[0].id);
                    }
                  }}
                />
              </label>

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
                    <button type="button" aria-label="同步滚动" aria-pressed={scrollMode === "linked"} onClick={() => setScrollMode("linked")}>
                      <LinkIcon aria-hidden="true" size={12} weight="bold" /><span>同步</span>
                    </button>
                    <button type="button" aria-label="独立滚动" aria-pressed={scrollMode === "independent"} onClick={() => setScrollMode("independent")}>
                      <LinkBreakIcon aria-hidden="true" size={12} weight="bold" /><span>独立</span>
                    </button>
                  </div>
                </div>
                <div className={styles.toolbarField}>
                  <span className={styles.toolbarFieldLabel}>画布缩放</span>
                  <div className={styles.zoomSwitch} aria-label="画布缩放">
                    <button type="button" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
                      <CornersOutIcon aria-hidden="true" size={12} /><span>适应</span>
                    </button>
                    <button type="button" aria-pressed={zoom === "actual"} onClick={() => setZoom("actual")}>100%</button>
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
            {filter !== "overview" && !navigableChanges.length ? (
              <div className={styles.emptyFilterNotice} role="status">
                {filter === "all"
                  ? "本轮没有检测到变化，仍可查看整页"
                  : `本轮没有检测到${FILTER_LABELS[filter]}变化，仍可切回整页或其他类型继续审阅`}
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
              />
            </div>

            <aside
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
                  aria-label={mapPinned ? "收起并取消固定内容地图" : "打开并固定内容地图"}
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
                  <div><span>页面内容地图 · {documents.outline.length} 个区域</span><strong>{activeChange ? `正在看：${activeChange.label}` : focus === "all" ? "整页总览" : "正在看未修改区域"}</strong></div>
                  <button type="button" aria-label={mapPinned ? "取消固定内容地图" : "固定内容地图"} aria-pressed={mapPinned} onClick={() => setMapPinned((current) => !current)}>
                    <PushPinIcon aria-hidden="true" size={15} weight={mapPinned ? "fill" : "duotone"} />
                  </button>
                </header>
                <button
                  className={styles.mapOverview}
                  type="button"
                  aria-pressed={displayMode === "preview-split" && focus === "all"}
                  onClick={() => selectPreviewMode("preview-split")}
                >
                  <EyeIcon aria-hidden="true" size={15} weight="duotone" />
                  <span><strong>完整页面</strong><small>查看修改前与修改后</small></span>
                </button>
                <div className={styles.mapGroups}>
                  {outlineGroups.map((group) => {
                    const matchingCount = group.items.filter((item) => (
                      Boolean(item.changeId)
                      && (filter === "overview" || filter === "all" || item.types.includes(filter))
                    )).length;
                    return (
                    <section className={styles.mapGroup} key={group.label}>
                      <h3><span>{group.label}</span><small>{matchingCount}/{group.items.length} 处匹配</small></h3>
                      <ol className={styles.mapList}>
                        {group.items.map((item) => {
                          const itemIndex = documents.outline.findIndex((candidate) => candidate.id === item.id);
                          const selected = focus === (item.changeId || item.id);
                          const matchesFilter = filter === "overview"
                            || (Boolean(item.changeId)
                              && (filter === "all" || item.types.includes(filter)));
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                data-testid="review-outline-item"
                                data-changed={item.changeId ? "true" : "false"}
                                data-matches-filter={matchesFilter ? "true" : "false"}
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
          ? `已切换为${DISPLAY_MODE_PROJECTION[displayMode].label}`
          : `已切换为${DISPLAY_MODE_PROJECTION[displayMode].label}，已聚焦${activeChange?.label || "页面区域"}`}
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
                : `接受全部并打开（${afterLabel}）？`}
            </h2>
            <p id="review-confirm-description">
              {confirmationAction === "return"
                ? `确认后不会采用这次 AI 返回的 ${afterLabel}；当前 HTML 将继续使用 ${beforeLabel}（AI 修改前），并返回本轮处理页面。AI 返回仍保留在本轮记录中，之后可以重新审阅。`
                : `确认后项目将切换到 AI 修改后的完整候选 ${afterLabel}。修改前的 ${beforeLabel} 与本轮记录仍会保留，但当前页面会打开 AI 修改后的版本。`}
            </p>
            <div>
              <button
                ref={continueReviewButtonRef}
                className={styles.dialogSecondary}
                type="button"
                onClick={closeConfirmation}
              >
                继续审阅
              </button>
              <button
                className={styles.dialogPrimary}
                type="button"
                onClick={confirmAndContinue}
              >
                {confirmationAction === "return" ? "返回修改前版本" : "确认接受并打开"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
