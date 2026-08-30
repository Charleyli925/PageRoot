import type { SemanticOperation } from "./semantic-operation-kernel.js";

type OperationOptions = {
  baseRevision: number;
  operationId?: string;
};

export declare function identityFreeSourceElementHtml(
  indexOrHtml: unknown,
  elementId: string,
): string;

export declare function createInsertElementOperation(
  indexOrHtml: unknown,
  options: OperationOptions & {
    parentElementId: string;
    beforeElementId?: string | null;
    html: string;
  },
): Extract<SemanticOperation, { type: "insertElement" }>;

export declare function createDuplicateElementOperation(
  indexOrHtml: unknown,
  options: OperationOptions & { elementId: string },
): Extract<SemanticOperation, { type: "insertElement" }>;

export declare function createDeleteElementOperation(
  indexOrHtml: unknown,
  options: OperationOptions & { elementId: string },
): Extract<SemanticOperation, { type: "deleteElement" }>;

export declare function createMoveElementOperation(
  indexOrHtml: unknown,
  options: OperationOptions & {
    elementId: string;
    parentElementId: string;
    beforeElementId?: string | null;
  },
): Extract<SemanticOperation, { type: "moveElement" }>;
