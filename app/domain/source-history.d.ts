export type SourceHistoryDirection = "undo" | "redo";
export type SourceHistoryKind = "text" | "style" | "structure" | "reorder";

export type SourceHistoryPatch = {
  startOffset: number;
  endOffset: number;
  before: string;
  after: string;
  kind: string;
};

export type SourceHistoryEntry = {
  operationId: string;
  kind: SourceHistoryKind;
  property?: string;
  editRevision: number;
  createdAt: string;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  forwardPatches: SourceHistoryPatch[];
  reversePatches: SourceHistoryPatch[];
  beforeTarget: Record<string, unknown> | null;
  afterTarget: Record<string, unknown> | null;
};

export type SourceHistoryState = {
  schemaVersion: "1.0.0";
  projectId: string;
  documentId: string;
  baseSourceSha256: string;
  cursor: number;
  revision: number;
  entries: SourceHistoryEntry[];
  appliedActions: Array<{
    actionId: string;
    direction: SourceHistoryDirection;
    operationId: string;
    cursor: number;
    revision: number;
    sourceSha256: string;
    appliedAt: string;
  }>;
  updatedAt: string;
};

export function createSourceOperationId(
  randomUUID?: () => string,
): string;
export function createSourceActionId(
  randomUUID?: () => string,
): string;
export function createEmptySourceHistory(options: {
  projectId: string;
  documentId: string;
  sourceSha256: string;
  now?: () => string;
}): SourceHistoryState;
export function normalizeSourceHistory(
  value: unknown,
  options: {
    projectId: string;
    documentId: string;
    sourceSha256: string;
    now?: () => string;
    resetOnSourceMismatch?: boolean;
  },
): SourceHistoryState;
export function sourceHistoryCapabilities(history: SourceHistoryState): {
  canUndo: boolean;
  canRedo: boolean;
  cursor: number;
  depth: number;
  revision: number;
  sourceSha256: string;
};
export function validateSourceHistoryOperationBytes(
  operations: SourceHistoryEntry[],
  source: string,
  target: string,
  sha256: (value: string) => string,
): void;
