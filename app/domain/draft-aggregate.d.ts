export type DraftRecord = Record<string, unknown>;

export type AuthoritativeDraft = {
  draftRevision: number;
  comments: DraftRecord[];
  changeEvents: DraftRecord[];
  deletedCommentIds: string[];
  appliedOperationIds: string[];
};

export type DraftMutation<TComment = DraftRecord, TEvent = DraftRecord> = {
  operationId: string;
  expectedDraftRevision: number;
  comments: TComment[];
  changeEvents: TEvent[];
  deletedCommentIds: string[];
};

export function createDraftOperationId(
  randomUUID?: (() => string) | undefined,
): string;
export function isDraftOperationId(value: unknown): boolean;
export function normalizeAuthoritativeDraft(value: unknown): AuthoritativeDraft;
export function rebaseDraftMutation<
  TPending extends DraftMutation<unknown, unknown>,
>(
  pending: TPending,
  authoritativeValue: unknown,
): TPending;
export function operationWasApplied(
  authoritativeValue: unknown,
  operationId: string,
): boolean;
