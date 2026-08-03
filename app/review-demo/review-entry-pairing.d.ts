export type ReviewPairableEntry = {
  identity: string;
  context: string;
  text: string;
  tagName: string;
  order: number;
};

export type ReviewEntryPairResult<T extends ReviewPairableEntry> = {
  pairs: Array<{ before: T; after: T }>;
  beforeOnly: T[];
  afterOnly: T[];
};

export function reviewTextSimilarity(beforeText: string, afterText: string): number;

export function pairReviewEntries<T extends ReviewPairableEntry>(
  beforeEntries: T[],
  afterEntries: T[],
): ReviewEntryPairResult<T>;
