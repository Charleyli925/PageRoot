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
  versionGraphLayout,
  type VersionLineageInput,
} from "./version-graph";
import {
  formatSidebarVersionDateTime,
  formatSidebarVersionTime,
  versionInheritanceDescription,
} from "./project-version-tree-model";
import type { ProjectVersionSummary } from "./types";

const SIDEBAR_VERSION_ROW_HEIGHT = 34;
const SIDEBAR_VERSION_LANE_WIDTH = 13;
const SIDEBAR_VERSION_TRACK_MARGIN = 8;
const SIDEBAR_VERSION_TRACK_TO_ICON = 6;
const SIDEBAR_VERSION_LANE_COUNT = 4;
const SIDEBAR_VERSION_NODE_RADIUS = 3.5;

type SidebarStyle = CSSProperties & Record<`--${string}`, string>;

export type ProjectVersionLoadResult = Readonly<{
  versions: ProjectVersionSummary[];
  reason?: string;
}>;

function laneStroke(lane: number): string {
  return `var(--sidebar-version-lane-${lane % SIDEBAR_VERSION_LANE_COUNT})`;
}

function laneCenter(lane: number): number {
  return SIDEBAR_VERSION_TRACK_MARGIN + lane * SIDEBAR_VERSION_LANE_WIDTH;
}

function rowCenter(row: number): number {
  return row * SIDEBAR_VERSION_ROW_HEIGHT + SIDEBAR_VERSION_ROW_HEIGHT / 2;
}

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
  isCurrentWorkingCopy = version.isActiveWorkingCopy,
  onOpen,
}: {
  version: ProjectVersionSummary;
  parent: ProjectVersionSummary | null;
  reducedMotion: boolean;
  isCurrentWorkingCopy?: boolean;
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
        aria-label={isCurrentWorkingCopy
          ? `${version.displayFileName}，当前版本`
          : version.displayFileName}
        aria-current={isCurrentWorkingCopy ? "true" : undefined}
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
        {isCurrentWorkingCopy ? <span className="sr-only">当前版本</span> : null}
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
}: {
  versions: readonly ProjectVersionSummary[];
  onOpenVersion: (version: ProjectVersionSummary) => void;
  isCurrentProject?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const now = useSidebarClock();
  const graphVersions = useMemo<VersionLineageInput[]>(() => versions.map((version) => ({
    id: version.versionId,
    ordinal: version.ordinal,
    basedOnVersionId: version.basedOnVersionId,
    previousVersionId: version.previousVersionId,
  })), [versions]);
  const layout = useMemo(() => versionGraphLayout(graphVersions), [graphVersions]);
  const byId = useMemo(
    () => new Map(versions.map((version) => [version.versionId, version])),
    [versions],
  );
  const currentPath = useMemo(() => {
    const parentById = new Map(versions.map((version) => [
      version.versionId,
      version.basedOnVersionId || version.previousVersionId || null,
    ]));
    const active = versions.find((version) => version.isActiveWorkingCopy);
    const path = new Set<string>();
    let cursor = active?.versionId || null;
    while (cursor && !path.has(cursor)) {
      path.add(cursor);
      cursor = parentById.get(cursor) || null;
    }
    return path;
  }, [versions]);
  const rowByIndex = useMemo(
    () => new Map(layout.rows.map((row) => [row.row, row])),
    [layout.rows],
  );
  const railWidth = SIDEBAR_VERSION_TRACK_MARGIN
    + Math.max(0, layout.laneCount - 1) * SIDEBAR_VERSION_LANE_WIDTH
    + 2;
  const treeStyle: SidebarStyle = {
    "--sidebar-version-rail-width": `${railWidth}px`,
    "--sidebar-version-row-height": `${SIDEBAR_VERSION_ROW_HEIGHT}px`,
    "--sidebar-version-track-to-icon": `${SIDEBAR_VERSION_TRACK_TO_ICON}px`,
  };

  if (!versions.length) {
    return <p className="sidebar-version-empty">暂无版本记录</p>;
  }

  return (
    <div
      className="sidebar-version-tree"
      style={treeStyle}
      role="tree"
      aria-label="版本继承树"
    >
      <svg
        className="sidebar-version-rail"
        width={railWidth}
        height={layout.rows.length * SIDEBAR_VERSION_ROW_HEIGHT}
        aria-hidden="true"
      >
        {layout.segments.map((segment) => {
          const from = rowByIndex.get(segment.fromRow);
          const to = rowByIndex.get(segment.toRow);
          const current = Boolean(
            from && to && currentPath.has(from.versionId) && currentPath.has(to.versionId),
          );
          return (
            <path
              className="sidebar-version-rail-path"
              data-current={current ? "true" : undefined}
              d={`M${laneCenter(segment.lane)} ${rowCenter(segment.fromRow)}V${rowCenter(segment.toRow)}`}
              key={`s${segment.lane}-${segment.fromRow}-${segment.toRow}`}
              stroke={laneStroke(segment.lane)}
            />
          );
        })}
        {layout.edges.map((edge) => {
          const current = currentPath.has(edge.toVersionId);
          const from = laneCenter(edge.fromLane);
          const to = laneCenter(edge.toLane);
          const top = rowCenter(edge.fromRow);
          return (
            <path
              className="sidebar-version-rail-path"
              data-current={current ? "true" : undefined}
              d={`M${from} ${top}H${to}V${rowCenter(edge.toRow)}`}
              key={`e${edge.fromVersionId}-${edge.toVersionId}`}
              stroke={laneStroke(edge.toLane)}
            />
          );
        })}
        {layout.rows.map((row) => {
          const current = isCurrentProject
            && byId.get(row.versionId)?.isActiveWorkingCopy === true;
          const onCurrentPath = currentPath.has(row.versionId);
          const center = { cx: laneCenter(row.lane), cy: rowCenter(row.row) };
          return (
            <g key={`n${row.versionId}`}>
              <circle
                className="sidebar-version-node"
                data-current={current ? "true" : undefined}
                data-current-path={onCurrentPath ? "true" : undefined}
                {...center}
                r={SIDEBAR_VERSION_NODE_RADIUS}
                stroke={laneStroke(row.lane)}
              />
              {current ? (
                <circle
                  className="sidebar-version-node-center"
                  {...center}
                  r={1.35}
                  fill="var(--sidebar-version-current-rail)"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="sidebar-version-rows">
        {layout.rows.map((row) => {
          const version = byId.get(row.versionId);
          if (!version) return null;
          const parentId = version.basedOnVersionId || version.previousVersionId || null;
          const parent = parentId ? byId.get(parentId) || null : null;
          const current = isCurrentProject && version.isActiveWorkingCopy;
          const onCurrentPath = currentPath.has(version.versionId);
          return (
            <div
              className="sidebar-version-row"
              data-current={current ? "true" : undefined}
              data-current-path={onCurrentPath ? "true" : undefined}
              data-latest={version.isLatestOfficial ? "true" : undefined}
              key={version.versionId}
              role="treeitem"
              aria-level={row.lane + 1}
              aria-selected={current}
            >
              <SidebarVersionFileName
                version={version}
                parent={parent}
                reducedMotion={reducedMotion}
                // Imported summaries retain their local lineage data, but
                // never advertise a globally current file to assistive tech.
                isCurrentWorkingCopy={current}
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
      <span className="sidebar-skeleton-rail" aria-hidden="true" />
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
