export declare const SEMANTIC_OPERATION_SCHEMA_VERSION: 1;

export interface SemanticElementPrecondition {
  elementId: string;
  tagName: string;
  expectedOuterHtmlSha256: string;
}

interface SemanticOperationEnvelope {
  schemaVersion: 1;
  operationId: string;
  baseRevision: number;
  expectedSourceSha256: string;
}

export type SemanticOperation = SemanticOperationEnvelope & (
  | { type: "setText"; target: SemanticElementPrecondition; text: string }
  | {
    type: "replaceTextRange";
    target: SemanticElementPrecondition;
    range: { startOffset: number; endOffset: number; quote: string };
    text: string;
  }
  | {
    type: "setAttribute";
    target: SemanticElementPrecondition;
    name: string;
    value: string | null;
  }
  | {
    type: "setStyle";
    target: SemanticElementPrecondition;
    property: string;
    value: string;
    important: boolean;
  }
  | {
    type: "insertElement";
    parent: SemanticElementPrecondition;
    before: SemanticElementPrecondition | null;
    html: string;
  }
  | { type: "deleteElement"; target: SemanticElementPrecondition }
  | {
    type: "moveElement";
    target: SemanticElementPrecondition;
    parent: SemanticElementPrecondition;
    before: SemanticElementPrecondition | null;
  }
  | { type: "replaceSubtree"; target: SemanticElementPrecondition; html: string }
);

export interface GeneratedSemanticInverseOperation extends SemanticOperationEnvelope {
  readonly type: "restoreExactSource";
}

export interface SemanticLineageEntry {
  operationId: string;
  type: string;
  baseRevision: number;
  nextRevision: number;
  beforeSourceSha256: string;
  afterSourceSha256: string;
}

export interface SemanticDocumentState {
  schemaVersion: 1;
  revision: number;
  sourceSha256: string;
  html: string;
  lineage: SemanticLineageEntry[];
}

export interface SemanticOperationResult {
  changed: boolean;
  html: string;
  sourceSha256: string;
  previousSourceSha256: string;
  baseRevision: number;
  nextRevision: number;
  lineageEntry: SemanticLineageEntry;
  inverseOperation: GeneratedSemanticInverseOperation;
  nextState: SemanticDocumentState;
  allocatedElementIds?: string[];
  insertedRootElementId?: string;
  materialization: {
    kind: "source-patch" | "trusted-exact-source-restore";
    [key: string]: unknown;
  };
}

export declare class SemanticOperationError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare function createSemanticDocumentState(
  html: string,
  options?: { revision?: number; lineage?: SemanticLineageEntry[] },
): SemanticDocumentState;

export declare function createSemanticElementPrecondition(
  indexOrHtml: unknown,
  elementId: string,
): SemanticElementPrecondition;

export declare function applySemanticOperation(
  state: SemanticDocumentState,
  operation: SemanticOperation | GeneratedSemanticInverseOperation,
  options?: { randomUUID?: () => string },
): SemanticOperationResult;

export declare class SemanticOperationKernel {
  createState(
    html: string,
    options?: { revision?: number; lineage?: SemanticLineageEntry[] },
  ): SemanticDocumentState;
  createTarget(indexOrHtml: unknown, elementId: string): SemanticElementPrecondition;
  apply(
    state: SemanticDocumentState,
    operation: SemanticOperation | GeneratedSemanticInverseOperation,
    options?: { randomUUID?: () => string },
  ): SemanticOperationResult;
}
