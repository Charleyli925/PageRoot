import type { SemanticOperation } from "../lib/semantic-operation-kernel.js";
import type { SourceIndexValue } from "./html-canvas-internal-types";

type OperationOptions = {
  elementId: string;
  baseRevision: number;
  operationId?: string;
};

export function inlineStyleOperation(
  sourceIndex: SourceIndexValue,
  options: OperationOptions & { property: string; value: string; important: boolean },
): Extract<SemanticOperation, { type: "setStyle" }>;

export function siblingReorderOperation(
  sourceIndex: SourceIndexValue,
  options: OperationOptions & { toIndex: number },
): Extract<SemanticOperation, { type: "moveElement" }>;
