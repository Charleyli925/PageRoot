import { useCallback, useState } from "react";

import type { DocumentSurfaceControllerCapability } from "../application/workspace-controller-capabilities.js";
import type {
  DocumentSurfaceCacheEntry,
  DocumentSurfaceCacheSnapshot,
} from "../application/document-surface-cache-session.js";
import type { WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { PageViewContext } from "../lib/page-view-context.js";
import type { CanvasMode, HtmlProject } from "./types";
import type { ActiveRun } from "../domain/run-lifecycle.js";

export function useDocumentSurfaceHandoff({
  cache,
  tabs,
  sourceSha256,
  renderedSourceSha256,
  canvasAuthority,
  canvasGeneration,
}: {
  cache: DocumentSurfaceCacheSnapshot;
  tabs: WorkbenchTabsSnapshot;
  sourceSha256: string | null;
  renderedSourceSha256: string | null;
  canvasAuthority: Readonly<{
    status?: string;
    generation?: number;
    renderedSha256?: string | null;
  }> | null;
  canvasGeneration: number;
}): {
  visibleCachedSurface: DocumentSurfaceCacheEntry | null;
  retainPresentedTab: (tabId: string) => void;
  completeHandoff: (tabId: string) => void;
} {
  const pending = cache.entries.find((entry) => (
    entry.tier === "hot" && entry.tabId === tabs.pendingTabId
  )) || null;
  const [retainedTabId, setRetainedTabId] = useState<string | null>(null);
  const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
  const terminal = Boolean(
    sourceSha256 && renderedSourceSha256 === sourceSha256
  ) || Boolean(
    canvasAuthority?.status === "verified"
    && canvasAuthority.generation === canvasGeneration
    && canvasAuthority.renderedSha256 === sourceSha256
  ) || canvasAuthority?.status === "failed";
  const retainPresentedTab = useCallback((tabId: string) => {
    setRetainedTabId(tabId);
  }, []);
  const completeHandoff = useCallback((tabId: string) => {
    setRetainedTabId((current) => current === tabId ? null : current);
  }, []);
  let visibleCachedSurface: DocumentSurfaceCacheEntry | null = pending;
  if (!visibleCachedSurface && active?.kind === "document" && retainedTabId && !terminal) {
    // Keep the inert cached page above the newly committed Canvas until that
    // exact Canvas generation verifies. Authority still mounts underneath.
    visibleCachedSurface = cache.entries.find((entry) => (
      entry.tier === "hot"
      && entry.tabId === retainedTabId
      && entry.tabId === active.tabId
      && entry.projectId === active.projectId
      && entry.documentId === active.documentId
      && entry.sourceSha256 === sourceSha256
    )) || null;
  }
  return { visibleCachedSurface, retainPresentedTab, completeHandoff };
}

export function readyVersionPublicationMatches(
  controller: DocumentSurfaceControllerCapability,
  run: ActiveRun,
): boolean {
  const snapshot = controller.getSnapshot();
  return Boolean(
    snapshot.projectSession?.projectId === run.projectId
    && snapshot.projectSession?.documentId === run.documentId
    && snapshot.versionSession?.currentExactVersionId === run.candidateVersionId,
  );
}

export function rememberActiveDocumentPresentation({
  controller,
  tabs,
  canvasMode,
  pageViewContext,
  scrollTop,
}: {
  controller: DocumentSurfaceControllerCapability;
  tabs: WorkbenchTabsSnapshot;
  canvasMode: CanvasMode;
  pageViewContext: PageViewContext | null;
  scrollTop: number;
}) {
  const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
  if (active?.kind !== "document") return null;
  return controller.updateDocumentSurfacePresentation(active.tabId, {
    canvasMode,
    pageViewContext,
    scrollTop,
  });
}

export function restoreCachedDocumentPresentation({
  controller,
  project,
  setPageViewContext,
  setCanvasMode,
  stage,
}: {
  controller: DocumentSurfaceControllerCapability;
  project: HtmlProject;
  setPageViewContext: (value: PageViewContext | null) => void;
  setCanvasMode: (value: CanvasMode) => void;
  stage: HTMLDivElement | null;
}) {
  const cached = controller.getSnapshot().documentSurfaceCache?.entries.find((entry) => (
    entry.projectId === project.projectId
    && entry.documentId === project.documentId
    && entry.sourceSha256 === project.sha256
  )) || null;
  setPageViewContext(cached?.pageViewContext as PageViewContext | null);
  if (!cached) return null;
  setCanvasMode(cached.canvasMode);
  window.requestAnimationFrame(() => {
    if (stage) stage.scrollTop = cached.scrollTop;
  });
  return cached;
}
