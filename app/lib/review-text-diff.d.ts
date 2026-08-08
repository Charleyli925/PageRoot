export type ReviewTextRange = {
  start: number;
  end: number;
};

export function reviewTextSimilarity(left: string, right: string): number;

export function mergeReviewTextRanges(
  ranges: readonly ReviewTextRange[],
): ReviewTextRange[];

export type ReviewTextChangeOperation = "none" | "insert" | "delete" | "replace";

export type ReadableReviewTextFootprintSide = {
  evidenceRanges: ReviewTextRange[];
  groups: ReviewTextRange[][];
  anchorOffset: number | null;
};

export type ReadableReviewTextFootprintPlan = {
  operation: ReviewTextChangeOperation;
  scope: "inline" | "block";
  density: number;
  before: ReadableReviewTextFootprintSide;
  after: ReadableReviewTextFootprintSide;
};

export function readableReviewTextFootprintPlan(
  beforeText: string,
  afterText: string,
  differences: {
    before: readonly ReviewTextRange[];
    after: readonly ReviewTextRange[];
  },
): ReadableReviewTextFootprintPlan;

export function sentenceAwareTextDifferences(
  beforeText: string,
  afterText: string,
): {
  before: ReviewTextRange[];
  after: ReviewTextRange[];
};
