import type { ReviewChangeType, ReviewSide } from "./types";

export type SourceEvidenceKind =
  | "text"
  | "added"
  | "removed"
  | "moved"
  | "reordered"
  | "attribute"
  | "style";
export type SourceEvidence = {
  id: string;
  stableId: string;
  parentStableId: string | null;
  kinds: SourceEvidenceKind[];
  types: ReviewChangeType[];
  beforePresent: boolean;
  afterPresent: boolean;
};
export type ReviewVisualVerdict = "changed" | "unchanged" | "unverified";
export type ReviewVisualSupport = "supported" | "unsupported";
export type ReviewVisualSourceBinding = {
  sessionId: string;
  sourceHash: Record<ReviewSide, string>;
  identity: ReviewVisualSupport;
  reason?: string;
};
export type ReviewVisualObservation = {
  sessionId: string;
  side: ReviewSide;
  sourceHash: string;
  generation: number;
  stableId: string;
  fingerprint?: string;
  visible: boolean;
  unverified?: boolean;
  failureReason?: string;
};
export function buildReviewVisualEvidence(
  beforeHtml: string,
  afterHtml: string,
  sessionId: string,
): { binding: ReviewVisualSourceBinding; evidence: SourceEvidence[] };
export function hasReviewSourceCandidate(evidence: SourceEvidence): boolean;
export function hasDeterministicReviewSourceEvidence(evidence: SourceEvidence): boolean;
export function isVisualOnlyReviewSourceEvidence(evidence: SourceEvidence): boolean;
export function reviewVisualVerdict(
  evidence: SourceEvidence,
  before: ReviewVisualObservation | undefined,
  after: ReviewVisualObservation | undefined,
  binding: ReviewVisualSourceBinding,
  generation: number,
): ReviewVisualVerdict;
