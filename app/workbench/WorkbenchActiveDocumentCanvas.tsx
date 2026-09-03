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

import styles from "./workbench-active-document-canvas.module.css";

type ActiveCanvasSnapshot = Readonly<{
  tabId: string;
  sourceSha256: string;
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

class ActiveCanvasSnapshotStore {
  #snapshot: ActiveCanvasSnapshot | null = null;
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = () => this.#snapshot;

  retain(snapshot: ActiveCanvasSnapshot) {
    if (
      this.#snapshot?.tabId === snapshot.tabId
      && this.#snapshot.sourceSha256 === snapshot.sourceSha256
    ) return;
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) listener();
  }

  reconcile(activeTabId: string | null) {
    if (!this.#snapshot || this.#snapshot.tabId === activeTabId) return;
    this.#snapshot = null;
    for (const listener of this.#listeners) listener();
  }
}

const noChange = () => {};

export default function WorkbenchActiveDocumentCanvas({
  activeTabId,
  activeSourceSha256,
  activeElement,
}: {
  activeTabId: string | null;
  activeSourceSha256: string | null;
  activeElement: ReactElement | null;
}) {
  const [session] = useState(() => new ActiveCanvasSnapshotStore());
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [trackedActiveTabId, setTrackedActiveTabId] = useState(activeTabId);
  const [reusedActiveTabId, setReusedActiveTabId] = useState<string | null>(null);
  if (trackedActiveTabId !== activeTabId) {
    setTrackedActiveTabId(activeTabId);
    setReusedActiveTabId(snapshot?.tabId === activeTabId ? activeTabId : null);
  } else if (
    reusedActiveTabId
    && snapshot?.sourceSha256 !== activeSourceSha256
  ) {
    setReusedActiveTabId(null);
  }

  useLayoutEffect(() => {
    if (!activeTabId || !activeSourceSha256 || !activeElement) return;
    session.retain({
      tabId: activeTabId,
      sourceSha256: activeSourceSha256,
      element: activeElement,
    });
  }, [activeElement, activeSourceSha256, activeTabId, session]);
  useLayoutEffect(() => {
    session.reconcile(activeTabId);
  }, [activeTabId, session, snapshot]);
  useEffect(() => {
    if (!activeTabId || snapshot?.sourceSha256 !== activeSourceSha256) return;
    performance.mark("pageroot:runtime-hot:visible-ready", {
      detail: Object.freeze({ tabId: activeTabId, sourceSha256: activeSourceSha256 }),
    });
  }, [activeSourceSha256, activeTabId, snapshot]);

  const current = snapshot ?? (
    activeTabId && activeSourceSha256 && activeElement
      ? { tabId: activeTabId, sourceSha256: activeSourceSha256, element: activeElement }
      : null
  );
  if (!current) return null;
  const active = current.tabId === activeTabId && Boolean(activeElement);
  const element = active && activeElement
    ? (reusedActiveTabId === activeTabId
        ? cloneElement(current.element, activeElement.props as InactiveCanvasProps)
        : activeElement)
    : cloneElement(current.element as ReactElement<InactiveCanvasProps>, {
        ref: null,
        locked: true,
        readOnly: true,
        onChange: noChange,
        onInteraction: noChange,
        onSelect: noChange,
        onRequestComment: noChange,
        onPageViewContextChange: noChange,
      });

  return (
    <div
      className={styles.host}
      data-testid="workbench-active-document-canvas-host"
      data-runtime-hot-count={1}
      data-runtime-hot-limit={1}
    >
      <div
        className={styles.entry}
        data-runtime-hot-active={active ? "true" : undefined}
        hidden={active ? undefined : true}
        inert={active ? undefined : true}
        aria-hidden={active ? undefined : true}
        key={current.tabId}
      >
        {element}
      </div>
    </div>
  );
}
