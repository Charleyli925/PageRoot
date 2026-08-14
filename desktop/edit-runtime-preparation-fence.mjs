import {
  isEditRuntimeRequestId,
  isEditRuntimeSourceSha256,
} from "../app/domain/edit-runtime-contract.js";

// During the external-source to Managed V1 activation hand-off, one retiring
// source generation may finish while its replacement begins. Two preserves
// that bounded hand-off without permitting unbounded renderer-triggered work.
const DEFAULT_MAXIMUM_CONCURRENT_PREPARATIONS = 2;
const DEFAULT_MAXIMUM_CONSUMED_PREPARATIONS = 128;
const MAXIMUM_SOURCE_PATH_LENGTH = 4_096;

function boundedPositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return normalized;
}

function normalizedPreparation({
  requestId,
  sourcePath,
  sourceSha256,
  canvasGeneration,
} = {}) {
  const normalizedSourcePath = String(sourcePath || "");
  const normalizedSourceSha256 = String(sourceSha256 || "").toLowerCase();
  if (
    !isEditRuntimeRequestId(requestId)
    || !normalizedSourcePath
    || normalizedSourcePath.length > MAXIMUM_SOURCE_PATH_LENGTH
    || !isEditRuntimeSourceSha256(normalizedSourceSha256)
    || !Number.isSafeInteger(canvasGeneration)
    || canvasGeneration < 0
  ) {
    throw new TypeError("Edit runtime preparation identity is invalid.");
  }
  return Object.freeze({
    requestId: String(requestId),
    key: JSON.stringify([
      normalizedSourcePath,
      normalizedSourceSha256,
      canvasGeneration,
    ]),
  });
}

/**
 * Main-owned one-shot admission for disposable Edit author-runtime captures.
 * A renderer request cannot reopen a consumed source/canvas identity, and the
 * app permits only the bounded external-to-Managed-V1 capture overlap.
 */
export function createEditRuntimePreparationFence({
  maximumConcurrentPreparations = DEFAULT_MAXIMUM_CONCURRENT_PREPARATIONS,
  maximumConsumedPreparations = DEFAULT_MAXIMUM_CONSUMED_PREPARATIONS,
} = {}) {
  const maximumConcurrent = boundedPositiveInteger(
    maximumConcurrentPreparations,
    "maximumConcurrentPreparations",
  );
  const maximumConsumed = boundedPositiveInteger(
    maximumConsumedPreparations,
    "maximumConsumedPreparations",
  );
  const consumedByKey = new Map();
  const consumedRequestIds = new Map();
  let inFlight = 0;

  return Object.freeze({
    claim(preparation) {
      const identity = normalizedPreparation(preparation);
      if (consumedByKey.has(identity.key) || consumedRequestIds.has(identity.requestId)) {
        throw new Error("Edit runtime preparation was already consumed.");
      }
      if (inFlight >= maximumConcurrent) {
        throw new Error("Edit runtime preparation is already in progress.");
      }
      if (consumedByKey.size >= maximumConsumed) {
        throw new Error("Edit runtime preparation history is at capacity.");
      }
      const record = { requestId: identity.requestId, inFlight: true };
      consumedByKey.set(identity.key, record);
      consumedRequestIds.set(identity.requestId, identity.key);
      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        record.inFlight = false;
        inFlight -= 1;
      };
    },
  });
}
