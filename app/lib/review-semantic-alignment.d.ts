export type ReviewSemanticAlignmentUnit = {
  kind: string;
  text?: string;
  stableId?: string | null;
  exactSignature?: string | null;
  affinities?: readonly string[];
  parentKey?: string | null;
};

export type ReviewSemanticAlignmentMatch =
  | "stable-id"
  | "exact-signature"
  | "weighted"
  | "unmatched";

export type ReviewSemanticAlignmentPair = {
  beforeIndex: number | null;
  afterIndex: number | null;
  match: ReviewSemanticAlignmentMatch;
  moved: boolean;
};

export type ReviewSemanticAlignmentOptions = {
  matrixBudget?: number;
  lookahead?: number;
};

export const REVIEW_SEMANTIC_ALIGNMENT_MATRIX_BUDGET: number;

export function alignReviewSemanticUnits(
  before: readonly ReviewSemanticAlignmentUnit[],
  after: readonly ReviewSemanticAlignmentUnit[],
  options?: ReviewSemanticAlignmentOptions,
): ReviewSemanticAlignmentPair[];
