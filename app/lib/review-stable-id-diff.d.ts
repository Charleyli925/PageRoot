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
};

export function analyzeReviewStableIdTopology(
  before: readonly ReviewStableIdDescriptor[],
  after: readonly ReviewStableIdDescriptor[],
): ReviewStableIdTopology;
