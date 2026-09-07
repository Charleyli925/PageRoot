"use client";

import {
  createPortal,
} from "react-dom";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  orderedProjectVersions,
  formatSidebarVersionDateTime,
  formatSidebarVersionTime,
  versionInheritanceDescription,
} from "./project-version-tree-model";
import type { ProjectVersionSummary } from "./types";

const SIDEBAR_VERSION_ROW_HEIGHT = 34;
type SidebarStyle = CSSProperties & Record<`--${string}`, string>;

export type ProjectVersionLoadResult = Readonly<{
  versions: ProjectVersionSummary[];
  reason?: string;
}>;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function useSidebarCellInteraction({
  overflow,
  reducedMotion,
}: {
  overflow: boolean;
  reducedMotion: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [escapeDismissed, setEscapeDismissed] = useState(false);
  const active = hovered || focused;

  useEffect(() => {
    if (!active || escapeDismissed) return undefined;
    const tooltipTimer = window.setTimeout(() => setTooltipVisible(true), 350);
    const scrollTimer = !reducedMotion && overflow
      ? window.setTimeout(() => setScrolling(true), 500)
      : null;
    return () => {
      window.clearTimeout(tooltipTimer);
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
    };
  }, [active, escapeDismissed, overflow, reducedMotion]);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setEscapeDismissed(true);
      setTooltipVisible(false);
      setScrolling(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return {
    scrolling: active && scrolling && !escapeDismissed && !reducedMotion,
    tooltipVisible: active && tooltipVisible && !escapeDismissed,
    handlers: {
      onMouseEnter: () => {
        setEscapeDismissed(false);
        setHovered(true);
      },
      onMouseLeave: () => {
        setHovered(false);
        if (focused) return;
        setTooltipVisible(false);
        setScrolling(false);
        setEscapeDismissed(false);
      },
      onFocus: () => {
        setEscapeDismissed(false);
        setFocused(true);
      },
      onBlur: () => {
        setFocused(false);
        if (hovered) return;
        setTooltipVisible(false);
        setScrolling(false);
        setEscapeDismissed(false);
      },
    },
  };
}

function SidebarTooltip({
  id,
  text,
  visible,
  anchorRef,
}: {
  id: string;
  text: string;
  visible: boolean;
  anchorRef: { current: HTMLElement | null };
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          anchorRect.left,
          window.innerWidth - tooltipRect.width - 8,
        ),
      );
      const below = anchorRect.bottom + 7;
      const top = below + tooltipRect.height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchorRect.top - tooltipRect.height - 7);
      setPosition({ left, top, ready: true });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, text, visible]);

  if (!visible || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="sidebar-version-tooltip"
      id={id}
      ref={tooltipRef}
      role="tooltip"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {text}
    </div>,
    document.body,
  );
}

function SidebarVersionFileName({
  version,
  parent,
  reducedMotion,
  isActiveVersion = false,
  onOpen,
}: {
  version: ProjectVersionSummary;
  parent: ProjectVersionSummary | null;
  reducedMotion: boolean;
  isActiveVersion?: boolean;
  onOpen: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflowWidth, setOverflowWidth] = useState(0);
  const interaction = useSidebarCellInteraction({
    overflow: overflowWidth > 0,
    reducedMotion,
  });
  const tooltipId = `sidebar-version-name-${useId().replace(/:/gu, "")}`;
  const description = versionInheritanceDescription(version, parent);
  const tooltipText = `${version.displayFileName}\n${description}`;

  useLayoutEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const text = measureRef.current;
      if (!viewport || !text) return;
      const width = Math.max(0, Math.ceil(text.getBoundingClientRect().width - viewport.clientWidth));
      setOverflowWidth((current) => current === width ? current : width);
    };
    measure();
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(measure)
      : null;
    if (observer && viewportRef.current) observer.observe(viewportRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [version.displayFileName]);

  const scrollDuration = Math.min(
    5_200,
    Math.max(1_900, 1_050 + overflowWidth * 22),
  );
  const style: SidebarStyle = {
    "--sidebar-version-scroll-distance": `${overflowWidth}px`,
    "--sidebar-version-scroll-duration": `${scrollDuration}ms`,
  };

  return (
    <>
      <button
        ref={buttonRef}
        className="sidebar-version-file"
        type="button"
        aria-label={isActiveVersion
          ? `${version.displayFileName}，当前页面`
          : version.displayFileName}
        aria-current={isActiveVersion ? "page" : undefined}
        aria-describedby={interaction.tooltipVisible ? tooltipId : undefined}
        onClick={onOpen}
        {...interaction.handlers}
      >
        <span className="sidebar-version-file-viewport" ref={viewportRef}>
          <span
            className="sidebar-version-file-text"
            data-scrolling={interaction.scrolling ? "true" : undefined}
            style={style}
          >
            {version.displayFileName}
          </span>
          <span className="sidebar-version-file-measure" ref={measureRef} aria-hidden="true">
            {version.displayFileName}
          </span>
        </span>
        {isActiveVersion ? <span className="sr-only">当前页面</span> : null}
      </button>
      <SidebarTooltip
        id={tooltipId}
        text={tooltipText}
        visible={interaction.tooltipVisible}
        anchorRef={buttonRef}
      />
    </>
  );
}

function SidebarVersionTime({
  version,
  now,
  onOpen,
}: {
  version: ProjectVersionSummary;
  now: Date;
  onOpen: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const interaction = useSidebarCellInteraction({ overflow: false, reducedMotion: true });
  const tooltipId = `sidebar-version-time-${useId().replace(/:/gu, "")}`;
  const fullTime = formatSidebarVersionDateTime(version.modifiedAt);
  return (
    <>
      <button
        ref={buttonRef}
        className="sidebar-version-time"
        type="button"
        aria-label={`最近安全写入时间：${fullTime}`}
        aria-describedby={interaction.tooltipVisible ? tooltipId : undefined}
        data-datetime={version.modifiedAt}
        onClick={onOpen}
        {...interaction.handlers}
      >
        {formatSidebarVersionTime(version.modifiedAt, now)}
      </button>
      <SidebarTooltip
        id={tooltipId}
        text={fullTime}
        visible={interaction.tooltipVisible}
        anchorRef={buttonRef}
      />
    </>
  );
}

function useSidebarClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      const remainder = Date.now() % 60_000;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, Math.max(1_000, 60_000 - remainder + 120));
    };
    schedule();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
  return now;
}

export function ProjectVersionTree({
  versions,
  onOpenVersion,
  isCurrentProject = true,
  activeVersionId = null,
}: {
  versions: readonly ProjectVersionSummary[];
  onOpenVersion: (version: ProjectVersionSummary) => void;
  isCurrentProject?: boolean;
  activeVersionId?: string | null;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const now = useSidebarClock();
  const rows = useMemo(() => orderedProjectVersions(versions), [versions]);
  const byId = useMemo(
    () => new Map(versions.map((version) => [version.versionId, version])),
    [versions],
  );
  const treeStyle: SidebarStyle = {
    "--sidebar-version-row-height": `${SIDEBAR_VERSION_ROW_HEIGHT}px`,
  };

  if (!versions.length) {
    return <p className="sidebar-version-empty">暂无版本记录</p>;
  }

  return (
    <div
      className="sidebar-version-tree"
      style={treeStyle}
      role="listbox"
      aria-label="版本列表"
    >
      <div className="sidebar-version-rows">
        {rows.map((version) => {
          const parentId = version.basedOnVersionId || version.previousVersionId || null;
          const parent = parentId ? byId.get(parentId) || null : null;
          const selected = isCurrentProject
            && Boolean(activeVersionId)
            && version.versionId === activeVersionId;
          return (
            <div
              className="sidebar-version-row"
              data-selected={selected ? "true" : undefined}
              data-current-editing={version.isActiveWorkingCopy ? "true" : undefined}
              data-latest={version.isLatestOfficial ? "true" : undefined}
              key={version.versionId}
              role="option"
              aria-selected={selected}
            >
              <span className="sidebar-version-index" aria-hidden="true">V{version.ordinal}</span>
              <SidebarVersionFileName
                version={version}
                parent={parent}
                reducedMotion={reducedMotion}
                isActiveVersion={selected}
                onOpen={() => onOpenVersion(version)}
              />
              <SidebarVersionTime
                version={version}
                now={now}
                onOpen={() => onOpenVersion(version)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectVersionTreeSkeleton() {
  return (
    <div className="sidebar-version-tree sidebar-version-tree-skeleton" aria-busy="true" aria-label="正在读取版本摘要">
      {[0, 1, 2].map((row) => (
        <div className="sidebar-version-skeleton-row" key={row}>
          <span className="sidebar-skeleton-dot" aria-hidden="true" />
          <span className="sidebar-skeleton-name" aria-hidden="true" />
          <span className="sidebar-skeleton-time" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
