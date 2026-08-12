import {
  RUNTIME_VISUAL_CONTRACT_VERSION,
  isRuntimeVisualSessionIdentity,
  isRuntimeVisualSourceSha256,
} from "../domain/runtime-visual-contract.js";
import type { RuntimeVisualEnvelope } from "../domain/runtime-visual-contract.js";
import {
  changedReviewRuntimeVisualCandidateKeys as changedCandidateKeysFromSnapshots,
  reviewRuntimeVisualMeanRgbDifference,
  reviewRuntimeVisualSnapshotComparison,
} from "../lib/review-runtime-visual.js";
import type {
  ReviewRuntimeVisualCandidate,
  ReviewRuntimeVisualSnapshot,
} from "../lib/review-runtime-visual.js";

export type ReviewRuntimeVisualSide = "before" | "after";

export type ReviewRuntimeVisualCaptureIdentity = {
  readonly contractVersion: 2;
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

async function decodedPngPixels(snapshot: ReviewRuntimeVisualSnapshot) {
  if (
    typeof createImageBitmap !== "function"
    || typeof OffscreenCanvas !== "function"
  ) return null;
  let bitmap: ImageBitmap | null = null;
  let canvas: OffscreenCanvas | null = null;
  try {
    const pngBytes = new Uint8Array(snapshot.pngBytes.byteLength);
    pngBytes.set(snapshot.pngBytes);
    bitmap = await createImageBitmap(new Blob([pngBytes.buffer], { type: "image/png" }));
    if (bitmap.width !== snapshot.width || bitmap.height !== snapshot.height) return null;
    canvas = new OffscreenCanvas(snapshot.width, snapshot.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, snapshot.width, snapshot.height).data;
  } catch {
    return null;
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

async function rasterMeanRgbDifference(
  before: ReviewRuntimeVisualSnapshot,
  after: ReviewRuntimeVisualSnapshot,
) {
  const beforePixels = await decodedPngPixels(before);
  if (!beforePixels) return null;
  const afterPixels = await decodedPngPixels(after);
  if (!afterPixels) return null;
  return reviewRuntimeVisualMeanRgbDifference(beforePixels, afterPixels);
}

/**
 * Runs only in trusted renderer memory after the owner parser accepted one
 * before/after pair. It never retries a capture; PNG decoding failure merely
 * suppresses that supplemental runtime fact.
 */
export async function changedReviewRuntimeVisualCandidateKeys({
  candidates,
  before,
  after,
}: {
  candidates: readonly ReviewRuntimeVisualCandidate[];
  before: readonly ReviewRuntimeVisualSnapshot[];
  after: readonly ReviewRuntimeVisualSnapshot[];
}): Promise<readonly string[]> {
  const beforeByKey = new Map(before.map((snapshot) => [snapshot.key, snapshot]));
  const afterByKey = new Map(after.map((snapshot) => [snapshot.key, snapshot]));
  const rasterMeanRgbDifferenceByKey = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.key;
    const beforeSnapshot = beforeByKey.get(key);
    const afterSnapshot = afterByKey.get(key);
    if (reviewRuntimeVisualSnapshotComparison(beforeSnapshot, afterSnapshot) !== "raster") {
      continue;
    }
    const difference = await rasterMeanRgbDifference(beforeSnapshot!, afterSnapshot!);
    if (difference !== null) rasterMeanRgbDifferenceByKey.set(key, difference);
  }
  return changedCandidateKeysFromSnapshots({
    candidates,
    before,
    after,
    rasterMeanRgbDifferenceByKey,
  });
}
