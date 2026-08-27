"use client";

import type {
  DocumentSurfaceCacheSnapshot,
} from "../application/document-surface-cache-session.js";
import HtmlDisplaySurface from "../components/HtmlDisplaySurface";
import styles from "./workbench-document-surface-cache.module.css";

export default function WorkbenchDocumentSurfaceCache({
  snapshot,
  pendingTabId,
  height,
}: {
  snapshot: DocumentSurfaceCacheSnapshot;
  pendingTabId: string | null;
  height: string;
}) {
  const hotEntries = snapshot.entries.filter((entry) => entry.tier === "hot");
  if (!hotEntries.length) return null;
  return (
    <div
      className={styles.cache}
      data-testid="workbench-document-surface-cache"
      data-visible={pendingTabId ? "true" : undefined}
      aria-hidden={!pendingTabId}
    >
      {hotEntries.map((entry) => (
        <div
          className={styles.entry}
          data-tier={entry.tier}
          data-tab-id={entry.tabId}
          hidden={entry.tabId !== pendingTabId}
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
