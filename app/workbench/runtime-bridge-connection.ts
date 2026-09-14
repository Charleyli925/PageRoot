export function runtimeBridgeConnectionReady(): boolean {
  if (typeof window === "undefined") return true;
  const runtime = window.stemmioRuntime;
  if (!runtime) return true;
  return Boolean(runtime.getBridgeConnection?.() || runtime.bridgePort);
}

export function subscribeRuntimeBridgeConnection(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  return window.stemmioRuntime?.onBridgeReady?.(() => listener()) || (() => {});
}

export function useRuntimeBridgeConnectionReady(): boolean {
  return useSyncExternalStore(
    subscribeRuntimeBridgeConnection,
    runtimeBridgeConnectionReady,
    () => true,
  );
}
import { useSyncExternalStore } from "react";
