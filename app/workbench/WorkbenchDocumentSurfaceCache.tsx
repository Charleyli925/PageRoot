"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  DocumentSurfaceCacheToken,
  DocumentSurfaceCacheSnapshot,
} from "../application/document-surface-cache-session.js";
import HtmlDisplaySurface from "../components/HtmlDisplaySurface";
import styles from "./workbench-document-surface-cache.module.css";

function cacheTokenKey(token: DocumentSurfaceCacheToken | null): string | null {
  return token ? `${token.tabId}:${token.sourceSha256}` : null;
}

export default function WorkbenchDocumentSurfaceCache({
  snapshot,
  visibleTabId,
  visibleSourceSha256,
  candidateTabId = null,
  candidateSourceSha256 = null,
  onVisibleReady,
  onHandoffComplete,
  onVisibleScroll,
  onFirstScroll,
  height,
}: {
  snapshot: DocumentSurfaceCacheSnapshot;
  visibleTabId: string | null;
  visibleSourceSha256: string | null;
  candidateTabId?: string | null;
  candidateSourceSha256?: string | null;
  onVisibleReady: (token: DocumentSurfaceCacheToken) => boolean;
  onHandoffComplete: (token: DocumentSurfaceCacheToken) => void;
  onVisibleScroll: (tabId: string, scrollTop: number) => void;
  onFirstScroll: (tabId: string, scrollTop: number) => void;
  height: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const priorVisibleTokenRef = useRef<DocumentSurfaceCacheToken | null>(null);
  // Keep the last ready projection painted while a newly selected cache entry
  // hydrates. The target remains mounted (but hidden) so its static display
  // can settle without exposing an unready frame.
  const [presentedToken, setPresentedToken] = useState<DocumentSurfaceCacheToken | null>(null);
  const readyTokenKeyRef = useRef<string | null>(null);
  const hotEntries = snapshot.entries.filter((entry) => entry.tier === "hot");
  const visibleToken = visibleTabId && visibleSourceSha256
    ? Object.freeze({ tabId: visibleTabId, sourceSha256: visibleSourceSha256 })
    : null;
  const candidateToken = candidateTabId && candidateSourceSha256
    ? Object.freeze({ tabId: candidateTabId, sourceSha256: candidateSourceSha256 })
    : null;
  const observedToken = candidateToken || visibleToken;
  const observedTokenKey = cacheTokenKey(observedToken);
  const presentedTokenIsHot = Boolean(
    presentedToken && hotEntries.some((entry) => (
      entry.tabId === presentedToken.tabId
      && entry.sourceSha256 === presentedToken.sourceSha256
    )),
  );

  useLayoutEffect(() => {
    if (!presentedToken || presentedTokenIsHot) return;
    readyTokenKeyRef.current = null;
    // A cache entry that left the hot pool must return as a hidden candidate
    // and wait for its newly mounted HtmlDisplaySurface to report readiness.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentedToken(null);
  }, [presentedToken, presentedTokenIsHot]);

  useEffect(() => {
    const prior = priorVisibleTokenRef.current;
    if (prior && cacheTokenKey(prior) !== cacheTokenKey(visibleToken)) {
      performance.mark("pageroot:tab-cache:handoff-complete", {
        detail: Object.freeze(prior),
      });
      onHandoffComplete(prior);
    }
    priorVisibleTokenRef.current = visibleToken;
    if (!observedToken) {
      readyTokenKeyRef.current = null;
      return undefined;
    }
    if (readyTokenKeyRef.current !== observedTokenKey) readyTokenKeyRef.current = null;

    const root = rootRef.current;
    let frame = 0;
    let observer: MutationObserver | null = null;
    let marked = false;
    let scrollableMarked = false;
    const markWhenReady = () => {
      const entry = [...(root?.querySelectorAll<HTMLElement>("[data-tab-id]") || [])]
        .find((candidate) => (
          candidate.dataset.tabId === observedToken.tabId
          && candidate.dataset.sourceSha256 === observedToken.sourceSha256
        ));
      const surface = entry?.querySelector<HTMLElement>("[data-display-ready]");
      if (surface?.dataset.displayReady !== "true") return false;
      // A candidate may still be waiting for the parent to publish its
      // retained id. It is safe to paint it now because this branch only runs
      // after the surface itself reports data-display-ready.
      if (!marked && readyTokenKeyRef.current !== observedTokenKey) {
        if (!onVisibleReady(observedToken)) return false;
        marked = true;
        readyTokenKeyRef.current = observedTokenKey;
        setPresentedToken(observedToken);
        performance.mark("pageroot:tab-cache:visible-ready", {
          detail: Object.freeze(observedToken),
        });
      } else {
        setPresentedToken(observedToken);
      }
      if (!scrollableMarked && surface.dataset.scrollableReady === "true") {
        scrollableMarked = true;
        performance.mark("pageroot:tab-cache:scrollable-ready", {
          detail: Object.freeze(observedToken),
        });
      }
      return scrollableMarked;
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
  }, [candidateSourceSha256, candidateTabId, onHandoffComplete, onVisibleReady, observedTokenKey, visibleSourceSha256, visibleTabId]);

  if (!hotEntries.length) return null;
  const renderedPresentedToken = presentedToken
    && visibleToken
    && cacheTokenKey(presentedToken) === cacheTokenKey(visibleToken)
    && hotEntries.some((entry) => (
      entry.tabId === presentedToken.tabId
      && entry.sourceSha256 === presentedToken.sourceSha256
    ))
    ? presentedToken
    : null;
  return (
    <div
      ref={rootRef}
      className={styles.cache}
      data-testid="workbench-document-surface-cache"
      data-visible={renderedPresentedToken ? "true" : undefined}
      data-visible-tab-id={renderedPresentedToken?.tabId || undefined}
      data-visible-source-sha256={renderedPresentedToken?.sourceSha256 || undefined}
      data-hot-count={snapshot.hotTabIds.length}
      data-warm-count={snapshot.warmTabIds.length}
      data-cold-count={snapshot.coldTabIds.length}
      data-cache-bytes={snapshot.totalBytes}
      data-max-hot-entries={snapshot.limits.maxHotEntries}
      data-max-cache-entries={snapshot.limits.maxEntries}
      data-max-cache-bytes={snapshot.limits.maxBytes}
      aria-hidden={!renderedPresentedToken}
    >
      {hotEntries.map((entry) => (
        <div
          className={styles.entry}
          data-tier={entry.tier}
          data-tab-id={entry.tabId}
          data-source-sha256={entry.sourceSha256}
          data-scroll-top={entry.scrollTop}
          hidden={entry.tabId !== renderedPresentedToken?.tabId
            || entry.sourceSha256 !== renderedPresentedToken?.sourceSha256}
          key={`${entry.tabId}:${entry.sourceSha256}`}
        >
          <HtmlDisplaySurface
            html={entry.html}
            sourcePath={entry.sourcePath}
            height={height}
            status={null}
            initialScrollTop={entry.scrollTop}
            onScrollTopChange={(scrollTop) => onVisibleScroll(entry.tabId, scrollTop)}
            onFirstScroll={(scrollTop) => onFirstScroll(entry.tabId, scrollTop)}
          />
        </div>
      ))}
    </div>
  );
}
