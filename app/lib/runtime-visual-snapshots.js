import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { RUNTIME_VISUAL_CONTRACT } from "../domain/runtime-visual-contract.js";

export const RUNTIME_VISUAL_SNAPSHOT_LIMIT =
  RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit;

const RUNTIME_VISUAL_PAGE_BUDGET = RUNTIME_VISUAL_CONTRACT.pageBudget;
const SNAPSHOT_KEYS = new Set([
  "key",
  "state",
  "pngSha256",
  "width",
  "height",
  "layoutWidth",
  "layoutHeight",
  "byteLength",
  "pngBytes",
  "renderedTextSha256",
]);
const PNG_HEADER = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function boundedPositiveInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : null;
}

function copiedPngBytes(value) {
  return value instanceof Uint8Array && value.byteLength <= RUNTIME_VISUAL_PAGE_BUDGET.pngBytes ? new Uint8Array(value) : null;
}

function pngDimensions(pngBytes) {
  if (pngBytes.byteLength < 24) return null;
  if (!PNG_HEADER.every((byte, index) => pngBytes[index] === byte)) return null;
  if (![73, 72, 68, 82].every((byte, index) => pngBytes[12 + index] === byte)) {
    return null;
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || Math.max(width, height) > RUNTIME_VISUAL_PAGE_BUDGET.pngDimension
    || width * height > RUNTIME_VISUAL_PAGE_BUDGET.canvasPixels
  ) return null;
  return Object.freeze({ width, height });
}

function acceptedUnavailableSnapshot(rawSnapshot, key) {
  const pngBytes = copiedPngBytes(rawSnapshot.pngBytes);
  if (
    rawSnapshot.pngSha256 !== ""
    || rawSnapshot.width !== 0
    || rawSnapshot.height !== 0
    || rawSnapshot.layoutWidth !== 0
    || rawSnapshot.layoutHeight !== 0
    || rawSnapshot.byteLength !== 0
    || rawSnapshot.renderedTextSha256 !== ""
    || !pngBytes
    || pngBytes.byteLength !== 0
  ) return null;
  return Object.freeze({
    key,
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    byteLength: 0,
    pngBytes,
    renderedTextSha256: "",
  });
}

function acceptedCapturedSnapshot(rawSnapshot, key) {
  const pngBytes = copiedPngBytes(rawSnapshot.pngBytes);
  const byteLength = boundedInteger(rawSnapshot.byteLength, RUNTIME_VISUAL_PAGE_BUDGET.pngBytes);
  const layoutWidth = boundedPositiveInteger(rawSnapshot.layoutWidth, RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxWidth);
  const layoutHeight = boundedPositiveInteger(rawSnapshot.layoutHeight, RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxHeight);
  if (
    !pngBytes
    || byteLength === null
    || layoutWidth === null
    || layoutHeight === null
    || byteLength !== pngBytes.byteLength
    || byteLength < 24
    || typeof rawSnapshot.pngSha256 !== "string"
    || !PNG_HASH_PATTERN.test(rawSnapshot.pngSha256)
    || typeof rawSnapshot.renderedTextSha256 !== "string"
    || !PNG_HASH_PATTERN.test(rawSnapshot.renderedTextSha256)
  ) return null;
  const dimensions = pngDimensions(pngBytes);
  if (
    !dimensions
    || rawSnapshot.width !== dimensions.width
    || rawSnapshot.height !== dimensions.height
    || `sha256:${bytesToHex(sha256(pngBytes))}` !== rawSnapshot.pngSha256
  ) return null;
  return Object.freeze({
    key,
    state: "captured",
    pngSha256: rawSnapshot.pngSha256,
    width: dimensions.width,
    height: dimensions.height,
    layoutWidth,
    layoutHeight,
    byteLength,
    pngBytes,
    renderedTextSha256: rawSnapshot.renderedTextSha256,
  });
}

/**
 * Accepts only the snapshots corresponding to the bounded candidate set the
 * trusted renderer requested for one Review capture pair.
 */
export function acceptRuntimeVisualSnapshots(value, allowedCandidateKeys) {
  if (
    !Array.isArray(value)
    || !(allowedCandidateKeys instanceof Set)
    || allowedCandidateKeys.size > RUNTIME_VISUAL_SNAPSHOT_LIMIT
    || value.length !== allowedCandidateKeys.size
    || value.length > RUNTIME_VISUAL_SNAPSHOT_LIMIT
  ) return null;

  const seen = new Set();
  const accepted = [];
  let pageBytes = 0;
  let pagePixels = 0;
  for (const rawSnapshot of value) {
    if (
      !isRecord(rawSnapshot)
      || Object.keys(rawSnapshot).some((key) => !SNAPSHOT_KEYS.has(key))
      || typeof rawSnapshot.key !== "string"
      || !allowedCandidateKeys.has(rawSnapshot.key)
      || seen.has(rawSnapshot.key)
    ) return null;
    const snapshot = rawSnapshot.state === "unavailable"
      ? acceptedUnavailableSnapshot(rawSnapshot, rawSnapshot.key)
      : rawSnapshot.state === "captured"
        ? acceptedCapturedSnapshot(rawSnapshot, rawSnapshot.key)
        : null;
    if (!snapshot) return null;
    pageBytes += snapshot.byteLength;
    pagePixels += snapshot.width * snapshot.height;
    if (
      pageBytes > RUNTIME_VISUAL_PAGE_BUDGET.aggregatePngBytes
      || pagePixels > RUNTIME_VISUAL_PAGE_BUDGET.canvasPixels
    ) return null;
    seen.add(snapshot.key);
    accepted.push(snapshot);
  }
  return Object.freeze(accepted);
}
