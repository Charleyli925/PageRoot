import {
  isDraftOperationId,
} from "./draft-aggregate.mjs";

/**
 * Draft commands must carry a current `draftop_` identifier. Missing IDs fail
 * closed; nothing allocates a substitute at ingress.
 */
export function decodeDraftCommandOperationId(value) {
  if (typeof value !== "string" || !isDraftOperationId(value)) {
    throw new TypeError("operationId must be a stable draftop_ identifier.");
  }
  return { operationId: value };
}
