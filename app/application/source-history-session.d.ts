import type {
  SourceHistoryDirection,
  SourceHistoryEntry,
  SourceHistoryState,
} from "../domain/source-history.js";

export type SourceHistoryContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type CanvasSourceTransaction = {
  kind: SourceHistoryEntry["kind"];
  property?: string;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  forwardPatches: SourceHistoryEntry["forwardPatches"];
  reversePatches: SourceHistoryEntry["reversePatches"];
  beforeTarget: SourceHistoryEntry["beforeTarget"];
  afterTarget: SourceHistoryEntry["afterTarget"];
  beforeSelection?: SourceHistoryEntry["beforeSelection"];
  afterSelection?: SourceHistoryEntry["afterSelection"];
};

export class SourceHistorySession {
  activate(
    context: SourceHistoryContext,
    sourceSha256: string,
    historyValue: unknown,
    options?: { preservePending?: boolean },
  ): SourceHistoryState;
  deactivate(): void;
  isActive(context: SourceHistoryContext): boolean;
  record(
    context: SourceHistoryContext,
    transaction: CanvasSourceTransaction,
    editRevision: number,
    createdAt?: string,
  ): SourceHistoryEntry;
  restorePending(
    context: SourceHistoryContext,
    operations: SourceHistoryEntry[],
  ): boolean;
  acknowledge(
    context: SourceHistoryContext,
    sentOperations: SourceHistoryEntry[],
    historyValue: unknown,
    sourceSha256: string,
  ): boolean;
  replaceAuthority(
    context: SourceHistoryContext,
    historyValue: unknown,
    sourceSha256: string,
  ): boolean;
  createAction(
    context: SourceHistoryContext,
    direction: SourceHistoryDirection,
  ): {
    actionId: string;
    direction: SourceHistoryDirection;
    expectedHistoryRevision: number;
    expectedHistoryCursor: number;
    expectedSourceSha256: string;
  } | null;
  readonly pendingOperations: SourceHistoryEntry[];
  readonly snapshot: SourceHistoryState | null;
  readonly capabilities: {
    canUndo: boolean;
    canRedo: boolean;
    cursor: number;
    depth: number;
    revision: number;
    sourceSha256: string;
  };
}
