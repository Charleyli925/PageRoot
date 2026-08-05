export type ReviewRuntimeVisualSnapshot = Readonly<{
  key: string;
  state: "empty" | "stable";
  contentSignature: string;
  paintSignature: string;
  geometrySignature: string;
  vectorSignature: string;
  canvasSignature: string;
  contentAtoms: number;
  paintAtoms: number;
  geometryAtoms: number;
  vectorAtoms: number;
  canvasPixels: number;
}>;

export type ReviewRuntimeVisualCandidate = Readonly<{
  key: string;
  outlineId: string;
  changeId: string;
  label: string;
  panelKey?: string;
  panelPath?: readonly string[];
}>;

export const REVIEW_RUNTIME_VISUAL_DEADLINE_MS: 500;

export function acceptReviewRuntimeVisualSnapshots(
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
  markers: readonly Readonly<{ key: string; changeId: string }>[];
}>;

export class ReviewRuntimeVisualCoordinator {
  constructor(options?: {
    candidates?: readonly ReviewRuntimeVisualCandidate[];
    onResolve?: (changedCandidateKeys: readonly string[]) => void;
    deadlineMs?: number;
    setTimer?: (callback: () => void, delay: number) => unknown;
    clearTimer?: (handle: unknown) => void;
  });
  readonly resolved: boolean;
  start(): boolean;
  accept(side: "before" | "after", rawSnapshots: unknown): boolean;
  dispose(): void;
}
