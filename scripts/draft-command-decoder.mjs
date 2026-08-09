import {
  createDraftOperationId,
  isDraftOperationId,
} from "./draft-aggregate.mjs";

/**
 * Decode the only legacy Draft command shape that was emitted by an older
 * packaged renderer: an otherwise valid command with no operationId.
 *
 * The generated id is deliberately the current draftop_ form. Historical
 * draftop_legacy_* entries stay opaque durable acknowledgements; no new
 * command or persisted acknowledgement may create that prefix.
 */
export function decodeDraftCommandOperationId(value, { randomUUID } = {}) {
  if (value === undefined || value === null || value === "") {
    return { operationId: createDraftOperationId(randomUUID) };
  }
  if (typeof value !== "string" || !isDraftOperationId(value)) {
    throw new TypeError("operationId must be a stable draftop_ identifier.");
  }
  return { operationId: value };
}
