import {
  RUNTIME_VISUAL_CONTRACT_VERSION,
  isRuntimeVisualSessionIdentity,
  isRuntimeVisualSourceSha256,
} from "../domain/runtime-visual-contract.js";
import type { RuntimeVisualEnvelope } from "../domain/runtime-visual-contract.js";

export type ReviewRuntimeVisualSide = "before" | "after";

export type ReviewRuntimeVisualCaptureIdentity = {
  readonly contractVersion: 1;
  readonly sessionId: string;
  readonly sourceSha256BySide: Readonly<Record<ReviewRuntimeVisualSide, string>>;
};

export function createReviewRuntimeVisualCaptureIdentity({
  sessionId,
  sourceSha256BySide,
}: {
  sessionId: string;
  sourceSha256BySide: Record<ReviewRuntimeVisualSide, string>;
}): ReviewRuntimeVisualCaptureIdentity {
  const before = sourceSha256BySide?.before;
  const after = sourceSha256BySide?.after;
  if (
    !isRuntimeVisualSessionIdentity(sessionId)
    || !isRuntimeVisualSourceSha256(before)
    || !isRuntimeVisualSourceSha256(after)
  ) {
    throw new TypeError("Review runtime capture identity is invalid.");
  }
  const immutableSources = Object.freeze({ before, after });
  return Object.freeze({
    contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
    sessionId,
    sourceSha256BySide: immutableSources,
  });
}

export function reviewRuntimeVisualEnvelopeForSide(
  identity: ReviewRuntimeVisualCaptureIdentity,
  side: ReviewRuntimeVisualSide,
): RuntimeVisualEnvelope {
  return Object.freeze({
    contractVersion: identity.contractVersion,
    sessionId: identity.sessionId,
    sourceSha256: identity.sourceSha256BySide[side],
  });
}
