import type { RuntimeVisualEnvelope } from "../domain/runtime-visual-contract.js";
import type { ReviewRuntimeVisualSnapshot } from "../lib/review-runtime-visual.js";

export type ReviewRuntimeCaptureSide = "before" | "after";

/**
 * This is an owner request, not an authored-page protocol. Candidate bindings
 * exist only in trusted renderer memory and transit the narrow preload IPC.
 */
export type ReviewRuntimeCaptureRequest = {
  readonly contractVersion: 1;
  readonly captureSessionId: string;
  readonly sourceSha256: string;
  readonly side: ReviewRuntimeCaptureSide;
  readonly html: string;
  readonly candidates: readonly ReviewRuntimeCaptureCandidate[];
  readonly viewport: Readonly<{ width: number; height: number }>;
};

export type ReviewRuntimeCaptureCandidate = {
  readonly key: string;
  readonly path: readonly number[];
  readonly tagName: string;
  readonly sourceBoxSignature: string;
  readonly identityAttributes: readonly (readonly [string, string])[];
  readonly identityText?: string;
};

export type ReviewRuntimeCaptureResult =
  | {
    readonly outcome: "captured";
    readonly envelope: RuntimeVisualEnvelope & {
      readonly runtimeVisualSnapshots: readonly ReviewRuntimeVisualSnapshot[];
    };
  }
  | {
    readonly outcome: "unstable" | "unmapped" | "timed-out" | "cancelled" | "failed";
    readonly reason: string;
  };

export type DesktopReviewRuntimeVisualApi = {
  capture: (
    payload: ReviewRuntimeCaptureRequest,
  ) => Promise<ReviewRuntimeCaptureResult>;
};

declare global {
  interface Window {
    htmlAIReviewRuntimeVisuals?: DesktopReviewRuntimeVisualApi;
  }
}
