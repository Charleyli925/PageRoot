export type LifecycleState =
  | "editing"
  | "submitting"
  | "processing"
  | "validating"
  | "committing"
  | "ready-to-open"
  | "awaiting-conflict-resolution"
  | "recovering-transaction"
  | "ready"
  | "no-change"
  | "complete"
  | "cancelled"
  | "error";

export const CANONICAL_LIFECYCLE_STATES: readonly LifecycleState[];
export function canonicalLifecycleState(
  value: unknown,
  options?: {
    readyVersion?: boolean;
    fallback?: LifecycleState;
  },
): LifecycleState;
export function isLockedLifecycleState(value: unknown): boolean;

export type ValidationReview = {
  status: "observed" | "pending";
  hardViolationCodes: string[];
  softViolationCodes: string[];
};

export function validationReviewFromRecord(
  value: unknown,
): ValidationReview | null;

export type ActiveRun = {
  projectId: string;
  documentId: string;
  requestId: string;
  attemptId: string;
  requestPath: string;
  attemptPath: string;
  handoffMessage: string;
  status: LifecycleState;
  sourcePath: string;
  baseSnapshotSha256: string;
  previousVersionId: string | null;
  basedOnVersionId: string | null;
  freezeCutoffRevision: number;
  candidateVersionId: string;
  candidateVersionLabel: string;
  submittedAt: string;
  summary?: string;
  commentCount?: number;
  changeEventCount?: number;
  error?: string;
  conflictId?: string;
  externalSourceSha256?: string;
  candidateOutputSha256?: string;
  conflictDetectedAt?: string;
  readyPayload?: Record<string, unknown>;
  validationReview?: ValidationReview;
  scopeReport?: Record<string, unknown>;
};

export function activeRunFromRecord(value: unknown): ActiveRun | null;
