"use client";

import { useEffect, type ReactElement } from "react";

import styles from "./workbench-active-document-canvas.module.css";

export default function WorkbenchActiveDocumentCanvas({
  activeTabId,
  activeSourceSha256,
  activeElement,
}: {
  activeTabId: string | null;
  activeSourceSha256: string | null;
  activeElement: ReactElement | null;
}) {
  useEffect(() => {
    if (!activeTabId || !activeSourceSha256 || !activeElement) return;
    performance.mark("pageroot:runtime-hot:visible-ready", {
      detail: Object.freeze({ tabId: activeTabId, sourceSha256: activeSourceSha256 }),
    });
  }, [activeElement, activeSourceSha256, activeTabId]);

  if (!activeElement) return null;
  return (
    <div
      className={styles.host}
      data-testid="workbench-active-document-canvas-host"
      data-runtime-hot-count={1}
      data-runtime-hot-limit={1}
    >
      <div
        className={styles.entry}
        data-runtime-hot-active="true"
        key={activeTabId || "none"}
      >
        {activeElement}
      </div>
    </div>
  );
}
