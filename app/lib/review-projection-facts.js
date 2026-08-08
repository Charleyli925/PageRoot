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
const FACT_TEXT_SCOPES = new Set(["inline", "sentence", "block"]);
const FACT_OPERATIONS = new Set(["none", "insert", "delete", "replace", "layout"]);
const FACT_TONES = new Set(["added", "removed"]);
const FACT_KEY_PATTERN = /^[a-z0-9:_-]{1,160}$/iu;
const MAX_FACTS_PER_ELEMENT = 24;
const MAX_SUMMARY_LENGTH = 80;

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
  const textScope = typeof value.textScope === "string" && FACT_TEXT_SCOPES.has(value.textScope)
    ? value.textScope
    : undefined;
  const structureChange = optionalKey(value.structureChange);
  const summary = optionalSummary(value.summary);
  const textDensity = Number(value.textDensity);

  if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
  if (scope) fact.scope = scope;
  if (ownerKey) fact.ownerKey = ownerKey;
  if (operation) fact.operation = operation;
  if (tone) fact.tone = tone;
  if (textGroup) fact.textGroup = textGroup;
  if (textScope) fact.textScope = textScope;
  if (structureChange) fact.structureChange = structureChange;
  if (summary) fact.summary = summary;
  if (Number.isFinite(textDensity) && textDensity >= 0 && textDensity <= 1) {
    fact.textDensity = textDensity;
  }
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

export function appendReviewProjectionFact(facts, value) {
  const next = normalizeReviewProjectionFact(value);
  const normalized = Array.isArray(facts)
    ? facts.map(normalizeReviewProjectionFact).filter(Boolean).slice(0, MAX_FACTS_PER_ELEMENT)
    : [];
  if (!next) return normalized;
  const existingIndex = normalized.findIndex((fact) => reviewProjectionFactsCanMerge(fact, next));
  if (existingIndex < 0) {
    return normalized.length < MAX_FACTS_PER_ELEMENT ? [...normalized, next] : normalized;
  }
  const existing = normalized[existingIndex];
  if (!reviewProjectionFactsCanMerge(existing, next)) return normalized;
  const updated = [...normalized];
  updated[existingIndex] = { ...existing, ...next };
  return updated;
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
    return parsed.reduce((result, fact) => appendReviewProjectionFact(result, fact), []);
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
