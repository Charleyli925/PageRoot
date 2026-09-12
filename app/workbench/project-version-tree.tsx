"use client";

import { useEffect, useMemo, useState } from "react";
import {
  orderedProjectVersions,
  formatSidebarVersionDateTime,
  formatSidebarVersionTime,
  versionInheritanceDescription,
} from "./project-version-tree-model";
import type { ProjectVersionSummary } from "./types";

export type ProjectVersionLoadResult = Readonly<{
  versions: ProjectVersionSummary[];
  reason?: string;
}>;

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
  activeVersionId = null,
}: {
  versions: readonly ProjectVersionSummary[];
  onOpenVersion: (version: ProjectVersionSummary) => void;
  /** Only the viewed immutable snapshot, never the current draft's base. */
  activeVersionId?: string | null;
}) {
  const now = useSidebarClock();
  const rows = useMemo(() => orderedProjectVersions(versions), [versions]);
  const byId = useMemo(
    () => new Map(versions.map((version) => [version.versionId, version])),
    [versions],
  );

  if (!rows.length) return <p className="sidebar-version-empty">暂无版本记录</p>;

  return (
    <ul className="sidebar-version-tree sidebar-version-rows" aria-label="历史版本">
      {rows.map((version) => {
        const parentId = version.basedOnVersionId || version.previousVersionId || null;
        const parent = parentId ? byId.get(parentId) || null : null;
        const selected = version.versionId === activeVersionId;
        return (
          <li
            className="sidebar-version-row"
            data-selected={selected ? "true" : undefined}
            key={version.versionId}
          >
            <button
              className="sidebar-version-file"
              type="button"
              aria-label={`V${version.ordinal}，历史版本`}
              aria-current={selected ? "page" : undefined}
              title={`${version.displayFileName}\n${versionInheritanceDescription(version, parent)}\n${formatSidebarVersionDateTime(version.modifiedAt)}`}
              onClick={() => onOpenVersion(version)}
            >
              <span className="sidebar-version-index">V{version.ordinal}</span>
              <time className="sidebar-version-time" dateTime={version.modifiedAt || undefined}>
                {formatSidebarVersionTime(version.modifiedAt, now)}
              </time>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectVersionTreeSkeleton() {
  return (
    <div className="sidebar-version-tree sidebar-version-tree-skeleton" aria-busy="true" aria-label="正在读取版本摘要">
      {[0, 1, 2].map((row) => (
        <div className="sidebar-version-skeleton-row" key={row}>
          <span className="sidebar-skeleton-name" aria-hidden="true" />
          <span className="sidebar-skeleton-time" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
