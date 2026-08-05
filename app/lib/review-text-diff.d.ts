export type ReviewTextRange = {
  start: number;
  end: number;
};

export function reviewTextSimilarity(left: string, right: string): number;

export function mergeReviewTextRanges(
  ranges: readonly ReviewTextRange[],
): ReviewTextRange[];

export type ReadableReviewTextFootprintPlan = {
  scope: "inline" | "block";
  density: number;
  before: { groups: ReviewTextRange[][] };
  after: { groups: ReviewTextRange[][] };
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
