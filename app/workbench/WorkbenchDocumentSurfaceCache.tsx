"use client";

import { useEffect, useRef } from "react";

import type {
  DocumentSurfaceCacheSnapshot,
} from "../application/document-surface-cache-session.js";
import HtmlDisplaySurface from "../components/HtmlDisplaySurface";
import styles from "./workbench-document-surface-cache.module.css";

export default function WorkbenchDocumentSurfaceCache({
  snapshot,
  visibleTabId,
  onVisibleReady,
  onHandoffComplete,
  height,
}: {
  snapshot: DocumentSurfaceCacheSnapshot;
  visibleTabId: string | null;
  onVisibleReady: (tabId: string) => void;
  onHandoffComplete: (tabId: string) => void;
  height: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const priorVisibleTabIdRef = useRef<string | null>(null);
  const hotEntries = snapshot.entries.filter((entry) => entry.tier === "hot");

  useEffect(() => {
    const prior = priorVisibleTabIdRef.current;
    if (prior && prior !== visibleTabId) {
      performance.mark("pageroot:tab-cache:handoff-complete", {
        detail: Object.freeze({ tabId: prior }),
      });
      onHandoffComplete(prior);
    }
    priorVisibleTabIdRef.current = visibleTabId;
    if (!visibleTabId) return undefined;

    const root = rootRef.current;
    let frame = 0;
    let observer: MutationObserver | null = null;
    let marked = false;
    const markWhenReady = () => {
      const entry = [...(root?.querySelectorAll<HTMLElement>("[data-tab-id]") || [])]
        .find((candidate) => candidate.dataset.tabId === visibleTabId);
      const surface = entry?.querySelector<HTMLElement>("[data-display-ready]");
      if (surface?.dataset.displayReady !== "true") return false;
      if (!marked) {
        marked = true;
        performance.mark("pageroot:tab-cache:visible-ready", {
          detail: Object.freeze({ tabId: visibleTabId }),
        });
        onVisibleReady(visibleTabId);
      }
      return true;
    };
    frame = window.requestAnimationFrame(() => {
      if (markWhenReady()) return;
      observer = new MutationObserver(() => {
        if (!markWhenReady()) return;
        observer?.disconnect();
        observer = null;
      });
      if (root) observer.observe(root, { attributes: true, subtree: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [onHandoffComplete, onVisibleReady, visibleTabId]);

  if (!hotEntries.length) return null;
  return (
    <div
      ref={rootRef}
      className={styles.cache}
      data-testid="workbench-document-surface-cache"
      data-visible={visibleTabId ? "true" : undefined}
      data-visible-tab-id={visibleTabId || undefined}
      data-hot-count={snapshot.hotTabIds.length}
      data-warm-count={snapshot.warmTabIds.length}
      data-cold-count={snapshot.coldTabIds.length}
      data-cache-bytes={snapshot.totalBytes}
      data-max-hot-entries={snapshot.limits.maxHotEntries}
      data-max-cache-entries={snapshot.limits.maxEntries}
      data-max-cache-bytes={snapshot.limits.maxBytes}
      aria-hidden={!visibleTabId}
    >
      {hotEntries.map((entry) => (
        <div
          className={styles.entry}
          data-tier={entry.tier}
          data-tab-id={entry.tabId}
          hidden={entry.tabId !== visibleTabId}
          key={entry.tabId}
        >
          <HtmlDisplaySurface
            html={entry.html}
            sourcePath={entry.sourcePath}
            height={height}
            status="已显示缓存页面，正在核对最新内容…"
          />
        </div>
      ))}
    </div>
  );
}
