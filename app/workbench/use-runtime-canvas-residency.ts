"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { EditAuthorRuntimeSnapshot } from "../application/edit-author-runtime-session.js";

import { DOCUMENT_CANVAS_POOL_MINIMUM } from "./WorkbenchDocumentCanvasPool";

export type RuntimeCanvasResidencyKey = Readonly<{
  tabId: string;
  sourceSha256: string;
  canvasGeneration: number;
}>;

class RuntimeCanvasResidencySession {
  #keys: readonly RuntimeCanvasResidencyKey[] = Object.freeze([]);
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = () => this.#keys;

  retain(
    tabId: string,
    sourceSha256: string,
    canvasGeneration: number,
    cacheable = true,
  ) {
    if (!tabId || !sourceSha256 || !Number.isSafeInteger(canvasGeneration)) return;
    if (!cacheable) {
      this.evict(tabId);
      return;
    }
    this.#publish([
      Object.freeze({ tabId, sourceSha256, canvasGeneration }),
      ...this.#keys.filter((entry) => entry.tabId !== tabId),
    ]);
  }

  evict(tabId: string) {
    this.#publish(this.#keys.filter((entry) => entry.tabId !== tabId));
  }

  reconcile(tabIds: readonly string[]) {
    const retained = new Set(tabIds);
    this.#publish(this.#keys.filter((entry) => retained.has(entry.tabId)));
  }

  #publish(keys: readonly RuntimeCanvasResidencyKey[]) {
    const next = keys.slice(0, DOCUMENT_CANVAS_POOL_MINIMUM);
    if (
      next.length === this.#keys.length
      && next.every((entry, index) => (
        entry.tabId === this.#keys[index]?.tabId
        && entry.sourceSha256 === this.#keys[index]?.sourceSha256
        && entry.canvasGeneration === this.#keys[index]?.canvasGeneration
      ))
    ) return;
    this.#keys = Object.freeze(next);
    for (const listener of this.#listeners) listener();
  }
}

export function useRuntimeCanvasResidency({
  tabIds,
  activeTabId,
  activeSourceSha256,
  activeCanvasGeneration,
  canvasMode,
  editRuntimeSnapshot,
  startPreparation,
}: {
  tabIds: readonly string[];
  activeTabId: string | null;
  activeSourceSha256: string | null;
  activeCanvasGeneration: number;
  canvasMode: "edit" | "preview";
  editRuntimeSnapshot: EditAuthorRuntimeSnapshot | null;
  startPreparation: (input: { sourceSha256: string; canvasGeneration: number }) => void;
}) {
  const [session] = useState(() => new RuntimeCanvasResidencySession());
  const keys = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const retain = useCallback((
    tabId: string,
    sourceSha256: string,
    canvasGeneration: number,
    cacheable = true,
  ) => {
    session.retain(tabId, sourceSha256, canvasGeneration, cacheable);
  }, [session]);
  const evict = useCallback((tabId: string) => {
    session.evict(tabId);
  }, [session]);
  const activeRetained = useMemo(() => Boolean(
    activeTabId
    && activeSourceSha256
    && keys.some((entry) => (
      entry.tabId === activeTabId
      && entry.sourceSha256 === activeSourceSha256
    )),
  ), [activeSourceSha256, activeTabId, keys]);
  const runtimePhase = editRuntimeSnapshot?.phase ?? "static";
  const runtimePreparing = canvasMode === "edit" && runtimePhase === "preparing";
  const runtimeRenderPending = canvasMode === "edit"
    && ["preparing", "ready", "running"].includes(runtimePhase);
  const runtimeGrant = canvasMode === "edit"
    && ["ready", "running", "settled"].includes(runtimePhase)
    ? editRuntimeSnapshot?.grant ?? null
    : null;

  useLayoutEffect(() => {
    const sourceSha256 = editRuntimeSnapshot?.sourceSha256;
    const canvasGeneration = editRuntimeSnapshot?.canvasGeneration;
    if (
      !runtimePreparing
      || !sourceSha256
      || typeof canvasGeneration !== "number"
      || !Number.isSafeInteger(canvasGeneration)
    ) return;
    const input = { sourceSha256, canvasGeneration };
    startPreparation(input);
  }, [
    editRuntimeSnapshot?.canvasGeneration,
    editRuntimeSnapshot?.sourcePath,
    editRuntimeSnapshot?.sourceSha256,
    runtimePreparing,
    startPreparation,
  ]);

  useEffect(() => {
    session.reconcile(tabIds);
  }, [session, tabIds]);
  useEffect(() => {
    if (activeRetained && activeTabId && activeSourceSha256) {
      session.retain(activeTabId, activeSourceSha256, activeCanvasGeneration);
    }
  }, [activeCanvasGeneration, activeRetained, activeSourceSha256, activeTabId, session]);

  return Object.freeze({
    keys,
    retain,
    evict,
    activeRetained,
    runtimePhase,
    runtimePreparing,
    runtimeRenderPending,
    runtimeGrant,
  });
}
