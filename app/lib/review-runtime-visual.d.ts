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

export function acceptRuntimeVisualSnapshots(
  value: unknown,
  allowedCandidateKeys: ReadonlySet<string>,
): readonly ReviewRuntimeVisualSnapshot[] | null;

export function changedReviewRuntimeVisualCandidateKeys(options?: {
  candidates?: readonly ReviewRuntimeVisualCandidate[];
  before?: readonly ReviewRuntimeVisualSnapshot[];
  after?: readonly ReviewRuntimeVisualSnapshot[];
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
}, changedCandidateKeys: readonly string[]): Readonly<{
  changes: readonly TChange[];
  outline: readonly TOutline[];
  markers: readonly Readonly<{ candidateKey: string; changeId: string }>[];
}>;
