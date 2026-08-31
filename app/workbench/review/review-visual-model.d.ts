import type { ReviewChangeType, ReviewSide } from "./types";

export type SourceEvidenceKind =
  | "observation"
  | "text"
  | "added"
  | "removed"
  | "moved"
  | "attribute"
  | "style"
  | "css-source"
  | "script-source"
  | "dynamic-runtime";
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
export function reviewVisualVerdict(
  evidence: SourceEvidence,
  before: ReviewVisualObservation | undefined,
  after: ReviewVisualObservation | undefined,
  binding: ReviewVisualSourceBinding,
  generation: number,
): ReviewVisualVerdict;
