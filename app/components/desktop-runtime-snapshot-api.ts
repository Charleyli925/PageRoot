import type { RuntimeSnapshotCaptureCandidate } from "../domain/runtime-snapshot-hosts.js";
import type { RuntimeVisualEnvelope } from "../domain/runtime-visual-contract.js";
import type { RuntimeVisualSnapshot } from "../lib/runtime-visual-snapshots.js";

export type RuntimeSnapshotCaptureSide = "before" | "after" | "edit";

/**
 * A trusted-renderer-to-main owner request. Candidate bindings stay inside this
 * narrow IPC request and the isolated owner; authored documents never receive
 * a target reference, binding, screenshot, or response channel.
 */
export type RuntimeSnapshotCaptureRequest = Readonly<{
  contractVersion: 1;
  captureSessionId: string;
  sourceSha256: string;
  side: RuntimeSnapshotCaptureSide;
  html: string;
  candidates: readonly RuntimeSnapshotCaptureCandidate[];
  viewport: Readonly<{ width: number; height: number }>;
}>;

export type RuntimeSnapshotCaptureResult =
  | Readonly<{
    outcome: "captured";
    envelope: RuntimeVisualEnvelope & Readonly<{
      runtimeVisualSnapshots: readonly RuntimeVisualSnapshot[];
    }>;
  }>
  | Readonly<{
    outcome: "timed-out" | "cancelled" | "failed";
    reason: string;
  }>;

export type DesktopRuntimeSnapshotApi = Readonly<{
  capture: (
    payload: RuntimeSnapshotCaptureRequest,
  ) => Promise<RuntimeSnapshotCaptureResult>;
}>;

declare global {
  interface Window {
    htmlAIRuntimeSnapshots?: DesktopRuntimeSnapshotApi;
  }
}
