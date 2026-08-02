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
} from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { PaletteIcon } from "@phosphor-icons/react/dist/csr/Palette";
import { PushPinIcon } from "@phosphor-icons/react/dist/csr/PushPin";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { TextTIcon } from "@phosphor-icons/react/dist/csr/TextT";
import { TreeStructureIcon } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import {
  buildReviewDocuments,
  type ReviewFilter,
  type ReviewDocuments,
  type ReviewSide,
} from "./review-document";
import styles from "./ai-review-workspace.module.css";

type ScrollMode = "linked" | "independent";
type ZoomMode = "fit" | "actual";
type ReviewDesktopSession = { sessionId: string; url: string };
type ReviewDesktopSessions = Record<ReviewSide, ReviewDesktopSession>;
type ReviewDesktopSessionResult = {
  documents: ReviewDocuments;
  sessions: ReviewDesktopSessions | null;
  failed: boolean;
};

const FILTER_LABELS: Record<ReviewFilter, string> = {
  overview: "整页",
  all: "变化",
  text: "文案",
  structure: "结构",
  style: "视觉",
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
      aria-label={`${side === "before" ? "修改前" : "修改后"}${label}完整页面`}
    >
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
  onKeepCurrent,
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
  onKeepCurrent: () => void;
  onAccept: () => void;
}) {
  const sessionId = `review-${useId().replace(/:/g, "-")}`;
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
        }
  ), [afterHtml, beforeHtml, hydrated, independentTransport, sessionId, sourcePath]);
  const [filter, setFilter] = useState<ReviewFilter>("overview");
  const [focus, setFocus] = useState("all");
  const [scrollMode, setScrollMode] = useState<ScrollMode>("linked");
  const [zoom, setZoom] = useState<ZoomMode>("actual");
  const [transparency, setTransparency] = useState(22);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const [mapPeeked, setMapPeeked] = useState(false);
  const [showKeepConfirm, setShowKeepConfirm] = useState(false);
  const [desktopSessionResult, setDesktopSessionResult] =
    useState<ReviewDesktopSessionResult | null>(null);
  const continueReviewButtonRef = useRef<HTMLButtonElement>(null);
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
  const reviewStateRef = useRef({ filter, focus, transparency });
  const desktopSessions = desktopSessionResult?.documents === documents
    ? desktopSessionResult.sessions
    : null;
  const reviewLoadFailed = desktopSessionResult?.documents === documents
    ? desktopSessionResult.failed
    : false;
  const activeIndex = Math.max(0, documents.changes.findIndex((change) => change.id === focus));
  const activeChange = documents.changes[activeIndex] || null;
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
    if (!showKeepConfirm) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      continueReviewButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [showKeepConfirm]);

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
        type: "scroll-to",
        top: Number(message.top || 0),
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

  const selectChange = useCallback((changeId: string) => {
    setFocus(changeId);
    setFilter((current) => current === "overview" ? "all" : current);
    (["before", "after"] as ReviewSide[]).forEach((side) => {
      postToFrame(framesRef.current[side], sessionId, {
        type: "focus-change",
        changeId,
        behavior: "smooth",
      });
    });
  }, [sessionId]);

  const navigate = useCallback((direction: -1 | 1) => {
    if (!documents.changes.length) return;
    const currentIndex = focus === "all" ? (direction > 0 ? -1 : 0) : activeIndex;
    const nextIndex = (currentIndex + direction + documents.changes.length) % documents.changes.length;
    selectChange(documents.changes[nextIndex].id);
  }, [activeIndex, documents.changes, focus, selectChange]);

  return (
    <div className={styles.reviewRoot} data-testid="ai-review-workspace">
      <header className={styles.appHeader}>
        <div className={styles.fileIdentity}>
          <button className={styles.brandButton} type="button" aria-label="返回源页工作台" onClick={onExit}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="./brand-logo.png" alt="源页" />
          </button>
          <div>
            <strong>{fileName}</strong>
            <span>{beforeLabel} → AI 完整候选版</span>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button className={styles.headerButton} type="button" disabled={accepting} onClick={() => setShowKeepConfirm(true)}>
            <ClockCounterClockwiseIcon aria-hidden="true" size={15} weight="duotone" />
            保留当前版本
          </button>
          <button className={styles.headerPrimaryAction} type="button" disabled={accepting} onClick={onAccept}>
            <CheckCircleIcon aria-hidden="true" size={15} weight="fill" />
            {accepting ? "正在核对并打开…" : "接受全部并打开"}
          </button>
          <button className={styles.headerIconButton} type="button" aria-label="退出审阅" title="退出审阅" disabled={accepting} onClick={onExit}>
            <XIcon aria-hidden="true" size={16} weight="bold" />
          </button>
        </div>
      </header>

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

      <main className={styles.reviewMain}>
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
                  <small>双页对比 · {documents.changes.length} 处变化</small>
                </span>
              </div>

              <div className={styles.canvasVersionPair} aria-label="对比版本">
                <span data-side="before">
                  <small>左 · 修改前</small>
                  <strong>{beforeLabel}</strong>
                  <ArrowSquareOutIcon aria-hidden="true" size={13} weight="bold" />
                </span>
                <span data-side="after">
                  <small>右 · 修改后</small>
                  <strong>AI 候选 {afterLabel}</strong>
                  <ArrowSquareOutIcon aria-hidden="true" size={13} weight="bold" />
                </span>
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
                  style={{ "--mask-position": `${transparency}%` } as CSSProperties}
                  onInput={(event) => setTransparency(Number(event.currentTarget.value))}
                />
              </label>

              <div className={styles.reviewModeControl}>
                <span className={styles.toolbarFieldLabel}>审阅显示方式</span>
                <div className={styles.segmented} aria-label="审阅显示方式">
                  {(["overview", "all", "text", "structure", "style"] as ReviewFilter[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-label={mode === "overview"
                        ? "查看整页"
                        : mode === "all"
                          ? "查看全部变化"
                          : `${FILTER_LABELS[mode]}变化`}
                      aria-pressed={filter === mode}
                      onClick={() => {
                        setFilter(mode);
                        if (mode === "overview") setFocus("all");
                      }}
                    >
                      {mode === "overview" ? <EyeIcon aria-hidden="true" size={14} weight="duotone" /> : null}
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
            <div className={styles.canvasGrid}>
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
                  <button type="button" aria-label="上一处变化" onClick={() => navigate(-1)}><CaretUpIcon aria-hidden="true" size={11} weight="bold" /></button>
                  <span><strong>{focus === "all" ? 0 : activeIndex + 1}</strong><small>/{documents.changes.length}</small></span>
                  <button type="button" aria-label="下一处变化" onClick={() => navigate(1)}><CaretDownIcon aria-hidden="true" size={11} weight="bold" /></button>
                </div>
              </div>
              <div className={styles.mapPanel} aria-hidden={!mapOpen} inert={!mapOpen ? true : undefined}>
                <header>
                  <div><span>页面内容地图</span><strong>{activeChange ? `正在看：${activeChange.label}` : "整页总览"}</strong></div>
                  <button type="button" aria-label={mapPinned ? "取消固定内容地图" : "固定内容地图"} aria-pressed={mapPinned} onClick={() => setMapPinned((current) => !current)}>
                    <PushPinIcon aria-hidden="true" size={15} weight={mapPinned ? "fill" : "duotone"} />
                  </button>
                </header>
                <button
                  className={styles.mapOverview}
                  type="button"
                  aria-pressed={focus === "all"}
                  onClick={() => { setFocus("all"); setFilter("overview"); }}
                >
                  <EyeIcon aria-hidden="true" size={15} weight="duotone" />
                  <span><strong>完整页面</strong><small>查看修改前与修改后</small></span>
                </button>
                <ol className={styles.mapList}>
                  {documents.changes.map((change, index) => (
                    <li key={change.id}>
                      <button type="button" aria-pressed={focus === change.id} onClick={() => selectChange(change.id)}>
                        <span>{index + 1}</span>
                        <span><strong>{change.label}</strong><small>{change.helper}</small></span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>
            <div className={styles.mapEdgeTrigger} aria-hidden="true" onMouseEnter={() => { if (!mapPinned) setMapPeeked(true); }} />
          </div>
        </section>
      </main>

      <span className={styles.srAnnouncement} aria-live="polite">
        {focus === "all" ? "正在查看完整页面" : `已聚焦${activeChange?.label || "变化区域"}`}
      </span>

      {showKeepConfirm ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowKeepConfirm(false);
          }}
        >
          <section
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="keep-current-title"
            aria-describedby="keep-current-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowKeepConfirm(false);
            }}
          >
            <div className={styles.confirmIcon}><ClockCounterClockwiseIcon aria-hidden="true" size={25} weight="duotone" /></div>
            <h2 id="keep-current-title">保留当前版本 {beforeLabel}？</h2>
            <p id="keep-current-description">当前 HTML 不会改变。确认后会返回本轮处理页面；AI 候选 {afterLabel} 仍会保留，你可以随时再次回到这个审阅页面。</p>
            <div>
              <button ref={continueReviewButtonRef} className={styles.dialogSecondary} type="button" onClick={() => setShowKeepConfirm(false)}>继续审阅</button>
              <button className={styles.dialogPrimary} type="button" onClick={() => { setShowKeepConfirm(false); onKeepCurrent(); }}>确认保留 {beforeLabel}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
