export function runtimeBridgeConnectionReady(): boolean {
  if (typeof window === "undefined") return true;
  const runtime = window.htmlAIRuntime;
  if (!runtime) return true;
  return Boolean(runtime.getBridgeConnection?.() || runtime.bridgePort);
}

export function subscribeRuntimeBridgeConnection(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  return window.htmlAIRuntime?.onBridgeReady?.(() => listener()) || (() => {});
}

export function useRuntimeBridgeConnectionReady(): boolean {
  return useSyncExternalStore(
    subscribeRuntimeBridgeConnection,
    runtimeBridgeConnectionReady,
    () => true,
  );
}
import { useSyncExternalStore } from "react";
