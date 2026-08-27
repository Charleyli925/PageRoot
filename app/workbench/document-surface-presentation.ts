import type { WorkspaceController } from "../application/workspace-controller.js";
import type { WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { PageViewContext } from "../lib/page-view-context.js";
import type { CanvasMode, HtmlProject } from "./types";
import type { ActiveRun } from "../domain/run-lifecycle.js";

export function readyVersionPublicationMatches(
  controller: WorkspaceController,
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
  controller: WorkspaceController;
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
  controller: WorkspaceController;
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
