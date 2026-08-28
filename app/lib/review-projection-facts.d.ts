export type ReviewProjectionFactType = "text" | "structure";

export type ReviewProjectionFactScope =
  | "text"
  | "text-phrase"
  | "text-line"
  | "text-block"
  | "element";

export type ReviewProjectionFact = {
  id: string;
  type: ReviewProjectionFactType;
  semanticOwnerId: string;
  geometryOwnerId?: string;
  scope?: ReviewProjectionFactScope;
  operation?: "none" | "insert" | "delete" | "replace";
  tone?: "added" | "removed";
  textGroup?: string;
  structureChange?: "added" | "removed";
  summary?: string;
};

export const REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT: number;

export class ReviewProjectionFactOverflowError extends Error {
  code: "REVIEW_PROJECTION_FACTS_OVERFLOW";
}

export function normalizeReviewProjectionFact(value: unknown): ReviewProjectionFact | null;
export function reviewProjectionFactKey(value: unknown): string;
export function reviewProjectionFactsCanMerge(left: unknown, right: unknown): boolean;
export function appendReviewProjectionFact(
  facts: readonly unknown[],
  value: unknown,
): ReviewProjectionFact[];
/** Throws ReviewProjectionFactOverflowError instead of silently discarding a fact. */
export function appendTrustedReviewProjectionFact(
  facts: readonly unknown[],
  value: unknown,
): ReviewProjectionFact[];
export function serializeReviewProjectionFacts(facts: readonly unknown[]): string;
export function parseReviewProjectionFacts(value: unknown): ReviewProjectionFact[];
export function reviewProjectionFactsForFilter(
  facts: readonly unknown[],
  filter: "all" | ReviewProjectionFactType,
): ReviewProjectionFact[];
