"use client";

import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type Ref,
} from "react";

import styles from "./workbench-document-canvas-pool.module.css";

export const DOCUMENT_CANVAS_POOL_MINIMUM = 5;

type CanvasSnapshot = Readonly<{
  tabId: string;
  sourceSha256: string;
  canvasGeneration: number;
  element: ReactElement;
}>;

type InactiveCanvasProps = Record<string, unknown> & {
  ref?: Ref<unknown> | null;
  locked?: boolean;
  readOnly?: boolean;
  onChange?: () => void;
  onInteraction?: () => void;
  onSelect?: () => void;
  onRequestComment?: () => void;
  onPageViewContextChange?: () => void;
};

class CanvasSnapshotSession {
  #entries: readonly CanvasSnapshot[] = Object.freeze([]);
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = () => this.#entries;

  retain(snapshot: CanvasSnapshot) {
    const currentIndex = this.#entries.findIndex((entry) => entry.tabId === snapshot.tabId);
    const current = this.#entries[currentIndex];
    if (current?.sourceSha256 === snapshot.sourceSha256) return;
    if (currentIndex >= 0) {
      const entries = [...this.#entries];
      entries[currentIndex] = snapshot;
      this.#publish(entries);
      return;
    }
    this.#publish([...this.#entries, snapshot]);
  }

  reconcile(tabIds: readonly string[]) {
    const allowed = new Set(tabIds);
    this.#publish(this.#entries.filter((entry) => allowed.has(entry.tabId)));
  }

  #publish(entries: readonly CanvasSnapshot[]) {
    if (
      entries.length === this.#entries.length
      && entries.every((entry, index) => entry === this.#entries[index])
    ) return;
    this.#entries = Object.freeze([...entries]);
    for (const listener of this.#listeners) listener();
  }
}

export default function WorkbenchDocumentCanvasPool({
  activeTabId,
  activeSourceSha256,
  activeCanvasGeneration,
  activeElement,
  retainedTabIds,
  onEvict,
}: {
  activeTabId: string | null;
  activeSourceSha256: string | null;
  activeCanvasGeneration: number;
  activeElement: ReactElement | null;
  retainedTabIds: readonly string[];
  onEvict: (tabId: string) => void;
}) {
  const [session] = useState(() => new CanvasSnapshotSession());
  const snapshots = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const noChange = () => {};

  useLayoutEffect(() => {
    if (activeTabId && activeSourceSha256 && activeElement) {
      session.retain(Object.freeze({
        tabId: activeTabId,
        sourceSha256: activeSourceSha256,
        canvasGeneration: activeCanvasGeneration,
        element: activeElement,
      }));
    }
  }, [activeCanvasGeneration, activeElement, activeSourceSha256, activeTabId, session]);
  useLayoutEffect(() => {
    const allowedTabIds = activeTabId && activeElement
      ? [activeTabId, ...retainedTabIds.filter((tabId) => tabId !== activeTabId)]
        .slice(0, DOCUMENT_CANVAS_POOL_MINIMUM)
      : retainedTabIds.slice(0, DOCUMENT_CANVAS_POOL_MINIMUM);
    for (const snapshot of snapshots) {
      if (!allowedTabIds.includes(snapshot.tabId)) onEvict(snapshot.tabId);
    }
    session.reconcile(allowedTabIds);
  }, [activeElement, activeTabId, onEvict, retainedTabIds, session, snapshots]);

  useEffect(() => {
    if (!activeTabId || !activeSourceSha256) return;
    const snapshot = snapshots.find((entry) => entry.tabId === activeTabId);
    if (snapshot?.sourceSha256 !== activeSourceSha256) return;
    performance.mark("pageroot:runtime-hot:visible-ready", {
      detail: Object.freeze({ tabId: activeTabId, sourceSha256: activeSourceSha256 }),
    });
  }, [activeSourceSha256, activeTabId, snapshots]);

  if (!activeTabId && activeElement) {
    return (
      <div className={styles.pool} data-testid="workbench-document-canvas-pool" data-runtime-hot-count={0} data-runtime-hot-limit={DOCUMENT_CANVAS_POOL_MINIMUM}>
        <div className={styles.entry}>{activeElement}</div>
      </div>
    );
  }
  const snapshotByTabId = new Map(snapshots.map((snapshot) => [snapshot.tabId, snapshot]));
  const retainedTabIdSet = new Set(retainedTabIds);
  const renderTabIds = [
    ...snapshots.map((snapshot) => snapshot.tabId).filter((tabId) => (
      tabId === activeTabId || retainedTabIdSet.has(tabId)
    )),
    ...(activeTabId && activeElement && !snapshotByTabId.has(activeTabId) ? [activeTabId] : []),
  ].slice(0, DOCUMENT_CANVAS_POOL_MINIMUM);
  if (!renderTabIds.length) return null;
  return (
    <div
      className={styles.pool}
      data-testid="workbench-document-canvas-pool"
      data-runtime-hot-count={renderTabIds.length}
      data-runtime-hot-limit={DOCUMENT_CANVAS_POOL_MINIMUM}
    >
      {renderTabIds.map((tabId) => {
        const snapshot = snapshotByTabId.get(tabId) ?? (
          tabId === activeTabId && activeSourceSha256 && activeElement
            ? { tabId, sourceSha256: activeSourceSha256, canvasGeneration: activeCanvasGeneration, element: activeElement }
            : null
        );
        if (!snapshot) return null;
        const active = tabId === activeTabId && Boolean(activeElement);
        const preserveActiveDocument = active && (
          snapshot.sourceSha256 === activeSourceSha256
          || snapshot.canvasGeneration === activeCanvasGeneration
        );
        const element = active && activeElement
          ? cloneElement(activeElement, {
            key: preserveActiveDocument ? snapshot.element.key : activeElement.key,
          })
          : snapshot.element;
        return (
          <div
            className={styles.entry}
            data-runtime-hot-tab-id={tabId}
            data-runtime-hot-active={active ? "true" : undefined}
            hidden={!active}
            inert={!active ? true : undefined}
            aria-hidden={!active}
            key={tabId}
          >
            {active ? element : cloneElement(element as ReactElement<InactiveCanvasProps>, {
              ref: null,
              locked: true,
              readOnly: true,
              onChange: noChange,
              onInteraction: noChange,
              onSelect: noChange,
              onRequestComment: noChange,
              onPageViewContextChange: noChange,
            })}
          </div>
        );
      })}
    </div>
  );
}
