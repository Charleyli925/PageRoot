export type ReviewStableIdDescriptor = {
  id: string;
  parentId?: string | null;
  index: number;
};

export type ReviewStableIdTopology = {
  commonIds: string[];
  addedIds: string[];
  removedIds: string[];
  movedIds: string[];
  reorderedRanges: Array<{
    parentId: string;
    beforeIds: string[];
    afterIds: string[];
  }>;
  duplicateIds: string[];
};

export function analyzeReviewStableIdTopology(
  before: readonly ReviewStableIdDescriptor[],
  after: readonly ReviewStableIdDescriptor[],
): ReviewStableIdTopology;
