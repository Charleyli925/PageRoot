"use client";

import { useMemo, useState, type CSSProperties } from "react";

import {
  baseHrefFromSourcePath,
  sanitizePreviewDocument,
} from "./html-preview-sandbox.js";
import { usePreviewResourceBase } from "./use-preview-resource-base";
import styles from "./HtmlDisplaySurface.module.css";

type HtmlDisplaySurfaceProps = {
  html: string;
  sourcePath?: string;
  height?: string;
  status?: string;
};

/**
 * A disposable, read-only first-paint surface. It deliberately has no Canvas
 * authority and can never serialize DOM back into source. The final editor
 * replaces it after edit-runtime preparation settles.
 */
export default function HtmlDisplaySurface({
  html,
  sourcePath,
  height = "720px",
  status = "页面已打开，编辑能力正在准备…",
}: HtmlDisplaySurfaceProps) {
  const fallbackBase = baseHrefFromSourcePath(sourcePath);
  const { resourceBase } = usePreviewResourceBase(html, sourcePath, false);
  const frameHtml = useMemo(
    () => sanitizePreviewDocument(html, resourceBase || fallbackBase),
    [fallbackBase, html, resourceBase],
  );
  const [loadedFrameHtml, setLoadedFrameHtml] = useState<string | null>(null);

  return (
    <div
      className={styles.surface}
      style={{ "--html-display-height": height } as CSSProperties}
      data-testid="html-display-surface"
      data-display-ready={loadedFrameHtml === frameHtml ? "true" : "false"}
    >
      <div className={styles.status} role="status">
        {status}
      </div>
      <iframe
        className={styles.frame}
        title="HTML 页面（正在准备编辑）"
        srcDoc={frameHtml}
        sandbox=""
        referrerPolicy="no-referrer"
        onLoad={() => {
          setLoadedFrameHtml(frameHtml);
          performance.mark("pageroot:document:static-frame-loaded");
        }}
      />
    </div>
  );
}
