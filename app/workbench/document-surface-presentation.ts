import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import type { DocumentSurfaceControllerCapability } from "../application/workspace-controller-capabilities.js";
import type {
  DocumentSurfaceCacheEntry,
  DocumentSurfaceCacheSnapshot,
  DocumentSurfaceCacheToken,
} from "../application/document-surface-cache-session.js";
import {
  documentSurfaceCacheEntryMatchesToken,
  documentSurfaceCacheToken,
  sameDocumentSurfaceCacheToken,
} from "../application/document-surface-cache-session.js";
import type { WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { PageViewContext } from "../lib/page-view-context.js";
import type { CanvasMode, HtmlProject } from "./types";
import type { ActiveRun } from "../domain/run-lifecycle.js";

function tokenForEntry(entry: DocumentSurfaceCacheEntry | null): DocumentSurfaceCacheToken | null {
  return documentSurfaceCacheToken(entry);
}

function entryForToken(
  cache: DocumentSurfaceCacheSnapshot,
  token: DocumentSurfaceCacheToken | null,
): DocumentSurfaceCacheEntry | null {
  if (!token) return null;
  return cache.entries.find((entry) => (
    documentSurfaceCacheEntryMatchesToken(entry, token)
  )) || null;
}

export function useDocumentSurfaceHandoff({
  cache,
  tabs,
  sourceSha256,
  renderedSourceSha256,
  canvasAuthority,
  canvasGeneration,
  controller,
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
  controller: DocumentSurfaceControllerCapability | null;
}): {
  visibleCachedSurface: DocumentSurfaceCacheEntry | null;
  candidateCachedSurface: DocumentSurfaceCacheEntry | null;
  visibleCachedSurfaceReady: boolean;
  retainPresentedTab: (token: DocumentSurfaceCacheToken) => boolean;
  completeHandoff: (token: DocumentSurfaceCacheToken) => void;
  updateVisibleScroll: (tabId: string, scrollTop: number) => void;
  markFirstScroll: (tabId: string, scrollTop: number) => void;
} {
  const pending = cache.entries.find((entry) => (
    entry.tier === "hot" && entry.tabId === tabs.pendingTabId
  )) || null;
  const pendingToken = tokenForEntry(pending);
  const [presentedToken, setPresentedToken] = useState<DocumentSurfaceCacheToken | null>(null);
  const [retainedCandidateToken, setCandidateToken] = useState<DocumentSurfaceCacheToken | null>(null);
  const pendingTabId = pendingToken?.tabId || null;
  const pendingSourceSha256 = pendingToken?.sourceSha256 || null;
  const presentedEntryIsHot = Boolean(
    presentedToken && entryForToken(cache, presentedToken),
  );
  useLayoutEffect(() => {
    if (!presentedToken || presentedEntryIsHot) return;
    // A demoted projection must not become visible again merely because the
    // cache promotes the same tab later; it must rehydrate as a candidate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentedToken(null);
  }, [presentedEntryIsHot, presentedToken]);
  useEffect(() => {
    if (!pendingTabId || !pendingSourceSha256) return;
    // The pending tab can commit before the static candidate reports ready;
    // retain its exact token across that commit without creating another
    // navigation/state owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateToken((current) => (
      current?.tabId === pendingTabId && current.sourceSha256 === pendingSourceSha256
        ? current
        : documentSurfaceCacheToken({ tabId: pendingTabId, sourceSha256: pendingSourceSha256 })
    ));
  }, [pendingSourceSha256, pendingTabId]);
  const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
  const terminal = Boolean(
    sourceSha256 && renderedSourceSha256 === sourceSha256
  ) || Boolean(
    canvasAuthority?.status === "verified"
    && canvasAuthority.generation === canvasGeneration
    && canvasAuthority.renderedSha256 === sourceSha256
  ) || canvasAuthority?.status === "failed";
  const retainPresentedTab = useCallback((token: DocumentSurfaceCacheToken) => {
    const entry = controller?.getSnapshot().documentSurfaceCache?.entries
      .find((candidate) => documentSurfaceCacheEntryMatchesToken(candidate, token));
    if (!entry) return false;
    const exactToken = tokenForEntry(entry);
    if (!exactToken) return false;
    setPresentedToken((current) => sameDocumentSurfaceCacheToken(current, exactToken) ? current : exactToken);
    controller?.confirmDocumentSurfaceReady(exactToken.tabId, exactToken.sourceSha256);
    return true;
  }, [controller]);
  const completeHandoff = useCallback((token: DocumentSurfaceCacheToken) => {
    setPresentedToken((current) => sameDocumentSurfaceCacheToken(current, token) ? null : current);
  }, []);
  const updateVisibleScroll = useCallback((tabId: string, scrollTop: number) => {
    controller?.updateDocumentSurfacePresentation(tabId, { scrollTop });
  }, [controller]);
  const markFirstScroll = useCallback((tabId: string, scrollTop: number) => {
    controller?.deferDocumentSurfacePrewarm();
    performance.mark("pageroot:tab-cache:first-scroll-response", {
      detail: Object.freeze({ tabId, scrollTop }),
    });
  }, [controller]);
  const activeCandidate = !presentedToken
    && !terminal
    && active?.kind === "document"
    && sourceSha256
    ? cache.entries.find((entry) => (
      entry.tier === "hot"
      && entry.tabId === active.tabId
      && entry.projectId === active.projectId
      && entry.documentId === active.documentId
      && entry.sourceSha256 === sourceSha256
    )) || null
    : null;
  const retainedCandidateIsActive = Boolean(
    retainedCandidateToken
    && active?.kind === "document"
    && active.tabId === retainedCandidateToken.tabId
    && sourceSha256 === retainedCandidateToken.sourceSha256,
  );
  const candidateToken = pendingToken
    || (retainedCandidateIsActive && !terminal ? retainedCandidateToken : null)
    || tokenForEntry(activeCandidate);
  const candidateCachedSurface = entryForToken(cache, candidateToken);
  const presentedCachedSurface = entryForToken(cache, presentedToken);
  const presentedMatchesActive = Boolean(
    presentedCachedSurface
    && active?.kind === "document"
    && presentedCachedSurface.tabId === active.tabId
    && presentedCachedSurface.projectId === active.projectId
    && presentedCachedSurface.documentId === active.documentId
    && presentedCachedSurface.sourceSha256 === sourceSha256,
  );
  // During a handoff, keep the old ready projection over the new live Canvas
  // until the target reports its own display-ready token. Once the target is
  // active and its Canvas is verified, normal authority takes over.
  const visibleCachedSurface = presentedCachedSurface && (
    Boolean(candidateCachedSurface)
    || (presentedMatchesActive && !terminal)
  ) ? presentedCachedSurface : null;
  return {
    visibleCachedSurface,
    candidateCachedSurface,
    visibleCachedSurfaceReady: Boolean(visibleCachedSurface),
    retainPresentedTab,
    completeHandoff,
    updateVisibleScroll,
    markFirstScroll,
  };
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
