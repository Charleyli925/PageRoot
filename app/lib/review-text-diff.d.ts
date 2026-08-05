export type ReviewTextRange = {
  start: number;
  end: number;
};

export function reviewTextSimilarity(left: string, right: string): number;

export function mergeReviewTextRanges(
  ranges: readonly ReviewTextRange[],
): ReviewTextRange[];

export function sentenceAwareTextDifferences(
  beforeText: string,
  afterText: string,
): {
  before: ReviewTextRange[];
  after: ReviewTextRange[];
};
