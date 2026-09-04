import type {
  SemanticIdentityDelta,
  SemanticOperation,
} from "../lib/semantic-operation-kernel.js";

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
  semanticOperation?: SemanticOperation;
  semanticDirection?: "forward" | "undo" | "redo";
  identityDelta?: SemanticIdentityDelta;
  beforeSelection?: {
    anchor: number;
    focus: number;
    affinity: "left" | "right";
  };
  afterSelection?: {
    anchor: number;
    focus: number;
    affinity: "left" | "right";
  };
};

export function createSourceOperationId(
  randomUUID?: () => string,
): string;
export function validateSourceHistoryOperationBytes(
  operations: SourceHistoryEntry[],
  source: string,
  target: string,
  sha256: (value: string) => string,
): void;
