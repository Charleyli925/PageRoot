export type ReviewTextRange = {
  start: number;
  end: number;
};

export function reviewTextSimilarity(left: string, right: string): number;

export function mergeReviewTextRanges(
  ranges: readonly ReviewTextRange[],
): ReviewTextRange[];

export function reviewSentenceRanges(
  value: string,
): ReviewTextRange[];

export type ReviewTextChangeOperation =
  | "none"
  | "insert"
  | "delete"
  | "replace"
  | "layout";

export type ReviewTextChangeSide = {
  evidenceRanges: ReviewTextRange[];
  phraseGroups: ReviewTextRange[][];
  anchorOffset: number | null;
};

export type ReadableReviewTextFootprintPlan = {
  operation: ReviewTextChangeOperation;
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

export function reconcileReviewTextSurvivors(
  beforeText: string,
  beforeRanges: readonly ReviewTextRange[],
  afterText: string,
  afterRanges: readonly ReviewTextRange[],
): {
  before: ReviewTextRange[];
  after: ReviewTextRange[];
};

export function sentenceAwareTextDifferences(
  beforeText: string,
  afterText: string,
): {
  before: ReviewTextRange[];
  after: ReviewTextRange[];
};
