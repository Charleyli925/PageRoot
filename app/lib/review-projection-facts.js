const FACT_TYPES = new Set(["text", "structure", "style"]);
const FACT_SCOPES = new Set([
  "text",
  "text-phrase",
  "text-line",
  "text-block",
  "element",
  "box",
  "content",
]);
const FACT_OPERATIONS = new Set(["none", "insert", "delete", "replace", "layout"]);
const FACT_TONES = new Set(["added", "removed"]);
const FACT_KEY_PATTERN = /^[a-z0-9:_-]{1,160}$/iu;
export const REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT = 24;
const MAX_SUMMARY_LENGTH = 80;

export class ReviewProjectionFactOverflowError extends Error {
  constructor(limit = REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT) {
    super(`Review projection fact limit (${limit}) exceeded for one element.`);
    this.name = "ReviewProjectionFactOverflowError";
    this.code = "REVIEW_PROJECTION_FACTS_OVERFLOW";
  }
}

function optionalKey(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return FACT_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

function optionalSummary(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= MAX_SUMMARY_LENGTH ? normalized : undefined;
}

/**
 * Normalize one disposable review-projection fact. Facts are analysis output,
 * not authored-document authority: malformed values are discarded rather than
 * guessed or coerced into a visible frame.
 */
export function normalizeReviewProjectionFact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = optionalKey(value.id);
  const type = typeof value.type === "string" ? value.type : "";
  const semanticOwnerId = optionalKey(value.semanticOwnerId);
  if (!id || !FACT_TYPES.has(type) || !semanticOwnerId) return null;

  const fact = { id, type, semanticOwnerId };
  const geometryOwnerId = optionalKey(value.geometryOwnerId);
  const scope = typeof value.scope === "string" && FACT_SCOPES.has(value.scope)
    ? value.scope
    : undefined;
  const ownerKey = optionalKey(value.ownerKey);
  const operation = typeof value.operation === "string" && FACT_OPERATIONS.has(value.operation)
    ? value.operation
    : undefined;
  const tone = typeof value.tone === "string" && FACT_TONES.has(value.tone)
    ? value.tone
    : undefined;
  const textGroup = optionalKey(value.textGroup);
  const structureChange = optionalKey(value.structureChange);
  const summary = optionalSummary(value.summary);

  if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
  if (scope) fact.scope = scope;
  if (ownerKey) fact.ownerKey = ownerKey;
  if (operation) fact.operation = operation;
  if (tone) fact.tone = tone;
  if (textGroup) fact.textGroup = textGroup;
  if (structureChange) fact.structureChange = structureChange;
  if (summary) fact.summary = summary;
  return fact;
}

/**
 * A fact ID is unique only within a change. Its type and owners are part of
 * the identity; U+001F cannot occur in the validated key alphabet, so it is
 * an unambiguous internal separator rather than a rendered identifier.
 */
export function reviewProjectionFactKey(value) {
  const fact = normalizeReviewProjectionFact(value);
  return fact
    ? [
      fact.type,
      fact.id,
      fact.semanticOwnerId,
      fact.geometryOwnerId || "",
    ].join("\u001f")
    : "";
}

export function reviewProjectionFactsCanMerge(left, right) {
  const normalizedLeft = normalizeReviewProjectionFact(left);
  const normalizedRight = normalizeReviewProjectionFact(right);
  return Boolean(
    normalizedLeft
    && normalizedRight
    && normalizedLeft.type === normalizedRight.type
    && normalizedLeft.id === normalizedRight.id
    && normalizedLeft.semanticOwnerId === normalizedRight.semanticOwnerId
    && (normalizedLeft.geometryOwnerId || "") === (normalizedRight.geometryOwnerId || ""),
  );
}

function appendNormalizedFact(facts, next, overflow) {
  if (!next) return facts;
  const existingIndex = facts.findIndex((fact) => reviewProjectionFactsCanMerge(fact, next));
  if (existingIndex >= 0) {
    const updated = [...facts];
    updated[existingIndex] = { ...updated[existingIndex], ...next };
    return updated;
  }
  if (facts.length < REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT) return [...facts, next];
  if (overflow === "throw") throw new ReviewProjectionFactOverflowError();
  return overflow === "fail-closed" ? null : facts;
}

function normalizedReviewProjectionFacts(facts, overflow = "truncate") {
  if (!Array.isArray(facts)) return [];
  let normalized = [];
  for (const value of facts) {
    const next = normalizeReviewProjectionFact(value);
    const appended = appendNormalizedFact(normalized, next, overflow);
    if (appended === null) return null;
    normalized = appended;
  }
  return normalized;
}

/**
 * Parse or compatibility callers stay bounded and never trust an oversized
 * payload. Trusted analysis must use appendTrustedReviewProjectionFact so an
 * incomplete projection can never masquerade as a complete one.
 */
export function appendReviewProjectionFact(facts, value) {
  const normalized = normalizedReviewProjectionFacts(facts);
  return appendNormalizedFact(normalized, normalizeReviewProjectionFact(value), "truncate");
}

export function appendTrustedReviewProjectionFact(facts, value) {
  const normalized = normalizedReviewProjectionFacts(facts, "throw");
  return appendNormalizedFact(normalized, normalizeReviewProjectionFact(value), "throw");
}

export function serializeReviewProjectionFacts(facts) {
  return JSON.stringify((Array.isArray(facts) ? facts : []).reduce(
    (result, fact) => appendReviewProjectionFact(result, fact),
    [],
  ));
}

export function parseReviewProjectionFacts(value) {
  if (typeof value !== "string" || value.length > 12_000) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizedReviewProjectionFacts(parsed, "fail-closed") || [];
  } catch {
    return [];
  }
}

export function reviewProjectionFactsForFilter(facts, filter) {
  const normalized = Array.isArray(facts)
    ? facts.map(normalizeReviewProjectionFact).filter(Boolean)
    : [];
  return filter === "all" ? normalized : normalized.filter((fact) => fact.type === filter);
}
