export type ReviewTextRange = {
  start: number;
  end: number;
};

export function reviewTextSimilarity(left: string, right: string): number;

export function mergeReviewTextRanges(
  ranges: readonly ReviewTextRange[],
): ReviewTextRange[];

export type ReviewTextChangeOperation =
  | "none"
  | "insert"
  | "delete"
  | "replace"
  | "layout";

export type ReviewTextChangeScope = "inline" | "sentence" | "block";

export type ReviewTextChangeSide = {
  evidenceRanges: ReviewTextRange[];
  footprintGroups: ReviewTextRange[][];
  anchorOffset: number | null;
};

export type ReadableReviewTextFootprintPlan = {
  operation: ReviewTextChangeOperation;
  scope: ReviewTextChangeScope;
  density: number;
  before: ReviewTextChangeSide;
  after: ReviewTextChangeSide;
};

export function readableReviewTextFootprintPlan(
  beforeText: string,
  afterText: string,
  differences: {
    before: readonly ReviewTextRange[];
    after: readonly ReviewTextRange[];
    layout?: boolean;
  },
): ReadableReviewTextFootprintPlan;

export function sentenceAwareTextDifferences(
  beforeText: string,
  afterText: string,
): {
  before: ReviewTextRange[];
  after: ReviewTextRange[];
};
