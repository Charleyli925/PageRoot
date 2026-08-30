import {
  isEditRuntimeRequestId,
  isEditRuntimeSourceSha256,
} from "../app/domain/edit-runtime-contract.js";

// During the external-source to Managed V1 activation hand-off, one retiring
// source generation may finish while its replacement begins. Two preserves
// that bounded hand-off without permitting unbounded renderer-triggered work.
const DEFAULT_MAXIMUM_CONCURRENT_PREPARATIONS = 2;
const DEFAULT_MAXIMUM_REMEMBERED_PREPARATIONS = 128;
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
  });
}

/**
 * Main-owned admission for disposable Edit author-runtime resource closures.
 * A renderer request cannot replay an in-flight or recently completed request
 * identity, and the app permits only the bounded external-to-Managed-V1
 * preparation overlap. Completed identities age out of a bounded FIFO rather
 * than exhausting the application lifetime.
 */
export function createEditRuntimePreparationFence({
  maximumConcurrentPreparations = DEFAULT_MAXIMUM_CONCURRENT_PREPARATIONS,
  maximumRememberedPreparations = DEFAULT_MAXIMUM_REMEMBERED_PREPARATIONS,
} = {}) {
  const maximumConcurrent = boundedPositiveInteger(
    maximumConcurrentPreparations,
    "maximumConcurrentPreparations",
  );
  const maximumRemembered = boundedPositiveInteger(
    maximumRememberedPreparations,
    "maximumRememberedPreparations",
  );
  const inFlightRequestIds = new Set();
  const rememberedRequestIds = new Set();
  const rememberedRequestOrder = [];

  return Object.freeze({
    claim(preparation) {
      const identity = normalizedPreparation(preparation);
      if (
        inFlightRequestIds.has(identity.requestId)
        || rememberedRequestIds.has(identity.requestId)
      ) {
        throw new Error("Edit runtime preparation was already consumed.");
      }
      if (inFlightRequestIds.size >= maximumConcurrent) {
        throw new Error("Edit runtime preparation is already in progress.");
      }
      inFlightRequestIds.add(identity.requestId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlightRequestIds.delete(identity.requestId);
        rememberedRequestIds.add(identity.requestId);
        rememberedRequestOrder.push(identity.requestId);
        while (rememberedRequestOrder.length > maximumRemembered) {
          const retiredRequestId = rememberedRequestOrder.shift();
          rememberedRequestIds.delete(retiredRequestId);
        }
      };
    },
  });
}
