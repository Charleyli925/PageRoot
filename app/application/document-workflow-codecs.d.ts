export type DirectEditEventAppenderInput = Readonly<{
  mutation: unknown;
  revision: unknown;
  createdAt: unknown;
  basedOnVersionId: unknown;
  events: unknown[];
  pendingEvents: unknown[];
  inFlightKeys: ReadonlySet<string>;
  nextEventId(): string;
}>;

export type DocumentWorkflowCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null, right: string | null): boolean;
  persistedChangeEvent(value: unknown): unknown;
  recoveryIdentityFromRecord(value: unknown): unknown;
  sourceHistoryOperationsFromRecord(value: unknown): unknown[];
  changesFromRecords(value: unknown): unknown[];
  historyTextSelectionFromRecord(value: unknown): unknown;
  selectionFromRecord(value: unknown): unknown;
  rebindTargetsPreservingGlobal(html: string, targets: unknown[]): unknown[];
  rebindTargetsAcrossHistoryPreservingGlobal(
    currentHtml: string,
    nextHtml: string,
    targets: unknown[],
    transition: unknown,
  ): unknown[];
  canLocateTarget(target: unknown): boolean;
  appendDirectEditEvent(value: DirectEditEventAppenderInput): {
    events: unknown[];
    pendingEvents: unknown[];
  };
  auditEventKey(value: unknown): string;
  removeAcknowledgedAuditEvents(current: unknown[], acknowledged: unknown[]): unknown[];
  errorMessage(cause: unknown, fallback: string): string;
}>;

export function createDocumentWorkflowCodecs(
  overrides: DocumentWorkflowCodecs,
): DocumentWorkflowCodecs;
