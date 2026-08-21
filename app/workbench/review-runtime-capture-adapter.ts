import {
  RUNTIME_VISUAL_CONTRACT_VERSION,
  isRuntimeVisualSessionIdentity,
  isRuntimeVisualSourceSha256,
} from "../domain/runtime-visual-contract.js";
import type { RuntimeVisualEnvelope } from "../domain/runtime-visual-contract.js";
import {
  classifyReviewRuntimeVisualCandidates as classifyCandidatesFromSnapshots,
  reviewRuntimeVisualMeanRgbDifference,
  reviewRuntimeVisualPixelsAreUniform,
  reviewRuntimeVisualStrongPixelRatio,
  reviewRuntimeVisualSnapshotComparison,
} from "../lib/review-runtime-visual.js";
import type {
  ReviewRuntimeVisualCandidate,
  ReviewRuntimeVisualSnapshot,
  ReviewRuntimeVisualVerdicts,
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

async function rasterDifference(
  before: ReviewRuntimeVisualSnapshot,
  after: ReviewRuntimeVisualSnapshot,
) {
  const beforePixels = await decodedPngPixels(before);
  if (!beforePixels) return null;
  const afterPixels = await decodedPngPixels(after);
  if (!afterPixels) return null;
  return {
    difference: reviewRuntimeVisualMeanRgbDifference(beforePixels, afterPixels),
    // How much of the surface differs strongly, which separates a repainted
    // chart from the same chart re-sampled at another sub-pixel offset.
    strongPixelRatio: reviewRuntimeVisualStrongPixelRatio(beforePixels, afterPixels),
    // A pair of near-uniform surfaces is a chart host that never rendered on
    // either side, not a verified-unchanged chart.
    uniform: reviewRuntimeVisualPixelsAreUniform(beforePixels)
      && reviewRuntimeVisualPixelsAreUniform(afterPixels),
  };
}

/**
 * Runs only in trusted renderer memory after the owner parser accepted one
 * before/after pair. It never retries a capture; a PNG that cannot be decoded
 * leaves its candidate unverified instead of silently reading as unchanged.
 */
export async function classifyReviewRuntimeVisualCandidateKeys({
  candidates,
  before,
  after,
}: {
  candidates: readonly ReviewRuntimeVisualCandidate[];
  before: readonly ReviewRuntimeVisualSnapshot[];
  after: readonly ReviewRuntimeVisualSnapshot[];
}): Promise<ReviewRuntimeVisualVerdicts> {
  const beforeByKey = new Map(before.map((snapshot) => [snapshot.key, snapshot]));
  const afterByKey = new Map(after.map((snapshot) => [snapshot.key, snapshot]));
  const rasterMeanRgbDifferenceByKey = new Map<string, number>();
  const rasterStrongPixelRatioByKey = new Map<string, number>();
  const uniformCandidateKeys = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.key;
    const beforeSnapshot = beforeByKey.get(key);
    const afterSnapshot = afterByKey.get(key);
    const comparison = reviewRuntimeVisualSnapshotComparison(beforeSnapshot, afterSnapshot);
    if (comparison === "raster") {
      const raster = await rasterDifference(beforeSnapshot!, afterSnapshot!);
      if (raster) {
        if (raster.difference !== null) {
          rasterMeanRgbDifferenceByKey.set(key, raster.difference);
        }
        if (raster.strongPixelRatio !== null) {
          rasterStrongPixelRatioByKey.set(key, raster.strongPixelRatio);
        }
        if (raster.uniform) uniformCandidateKeys.add(key);
      }
      continue;
    }
    if (comparison === "unchanged") {
      // Byte-identical PNGs need only one side decoded. An undecodable capture
      // reads as uniform, which fails closed into the unverified verdict.
      const pixels = await decodedPngPixels(beforeSnapshot!);
      if (reviewRuntimeVisualPixelsAreUniform(pixels)) uniformCandidateKeys.add(key);
    }
  }
  return classifyCandidatesFromSnapshots({
    candidates,
    before,
    after,
    rasterMeanRgbDifferenceByKey,
    rasterStrongPixelRatioByKey,
    uniformCandidateKeys,
  });
}
