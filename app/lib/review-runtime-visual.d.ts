import type { RuntimeVisualSnapshot } from "./runtime-visual-snapshots.js";

export type ReviewRuntimeVisualSnapshot = RuntimeVisualSnapshot;

export type ReviewRuntimeVisualCandidate = Readonly<{
  key: string;
  outlineId: string;
  changeId: string;
  label: string;
  sourceHostTargetRefs?: Readonly<{
    before: Readonly<Record<string, unknown>>;
    after: Readonly<Record<string, unknown>>;
  }>;
  panelKey?: string;
  panelPath?: readonly string[];
}>;

export const REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT: 32;
export const REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET: 0.04;
export const REVIEW_RUNTIME_VISUAL_UNIFORM_CHANNEL_SPREAD_LIMIT: 3;

export type ReviewRuntimeVisualVerdicts = Readonly<{
  changedKeys: readonly string[];
  unverifiedKeys: readonly string[];
}>;

export type ReviewRuntimeVisualMarker = Readonly<{
  candidateKey: string;
  changeId: string;
  verdict: "changed" | "suspected";
}>;

export function reviewRuntimeVisualSnapshotComparison(
  before: ReviewRuntimeVisualSnapshot | undefined,
  after: ReviewRuntimeVisualSnapshot | undefined,
): "unavailable" | "unchanged" | "changed" | "raster";

export function reviewRuntimeVisualMeanRgbDifference(
  beforePixels: Uint8Array | Uint8ClampedArray | unknown,
  afterPixels: Uint8Array | Uint8ClampedArray | unknown,
): number | null;

export function isReviewRuntimeVisualRasterDifferenceMeaningful(value: unknown): boolean;

export function reviewRuntimeVisualPixelsAreUniform(
  pixels: Uint8Array | Uint8ClampedArray | unknown,
): boolean;

export function classifyReviewRuntimeVisualCandidates(options?: {
  candidates?: readonly ReviewRuntimeVisualCandidate[];
  before?: readonly ReviewRuntimeVisualSnapshot[];
  after?: readonly ReviewRuntimeVisualSnapshot[];
  rasterMeanRgbDifferenceByKey?: ReadonlyMap<string, number>;
  uniformCandidateKeys?: ReadonlySet<string> | readonly string[];
}): ReviewRuntimeVisualVerdicts;

export function acceptRuntimeVisualSnapshots(
  value: unknown,
  allowedCandidateKeys: ReadonlySet<string>,
): readonly ReviewRuntimeVisualSnapshot[] | null;

export function changedReviewRuntimeVisualCandidateKeys(options?: {
  candidates?: readonly ReviewRuntimeVisualCandidate[];
  before?: readonly ReviewRuntimeVisualSnapshot[];
  after?: readonly ReviewRuntimeVisualSnapshot[];
  rasterMeanRgbDifferenceByKey?: ReadonlyMap<string, number>;
}): readonly string[];

export function mergeReviewRuntimeVisualChanges<
  TChange extends { id: string; helper: string; types: readonly string[] },
  TOutline extends {
    id: string;
    helper: string;
    types: readonly string[];
    changeId?: string;
  },
>(documents: {
  changes: readonly TChange[];
  outline: readonly TOutline[];
  runtimeVisualCandidates?: readonly ReviewRuntimeVisualCandidate[];
}, verdicts: readonly string[] | ReviewRuntimeVisualVerdicts): Readonly<{
  changes: readonly (TChange & { suspected?: boolean })[];
  outline: readonly TOutline[];
  markers: readonly ReviewRuntimeVisualMarker[];
}>;
