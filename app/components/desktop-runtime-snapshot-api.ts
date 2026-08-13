import type { RuntimeSnapshotCaptureCandidate } from "../domain/runtime-snapshot-hosts.js";
import type { RuntimeVisualEnvelope } from "../domain/runtime-visual-contract.js";
import type { RuntimeVisualSnapshot } from "../lib/runtime-visual-snapshots.js";

export type ReviewRuntimeSnapshotCaptureSide = "before" | "after";

/**
 * A trusted-renderer-to-main owner request. Candidate bindings stay inside this
 * narrow IPC request and the isolated owner; authored documents never receive
 * a target reference, binding, screenshot, or response channel.
 */
export type ReviewRuntimeSnapshotCaptureRequest = Readonly<{
  contractVersion: 2;
  captureSessionId: string;
  sourceSha256: string;
  side: ReviewRuntimeSnapshotCaptureSide;
  html: string;
  candidates: readonly RuntimeSnapshotCaptureCandidate[];
  viewport: Readonly<{ width: number; height: number }>;
}>;

export type ReviewRuntimeSnapshotCaptureResult =
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

export type DesktopReviewRuntimeSnapshotApi = Readonly<{
  capture: (
    payload: ReviewRuntimeSnapshotCaptureRequest,
  ) => Promise<ReviewRuntimeSnapshotCaptureResult>;
}>;

declare global {
  interface Window {
    htmlAIReviewRuntimeSnapshots?: DesktopReviewRuntimeSnapshotApi;
  }
}
