import { buildSourceIndex } from "../lib/source-index.js";

export const INLINE_VISUAL_PROFILE_VERSION = "0.1";
export const INLINE_VISUAL_PROFILE_META_NAME = "pageroot-report-profile";
export const INLINE_VISUAL_PROFILE_DEFAULT_SLOT_LIMIT = 32;

export const INLINE_VISUAL_PROFILE_TIERS = Object.freeze({
  PROFILE_FIXED: "profile-fixed",
  LEGACY_CANDIDATE: "legacy-candidate",
  PREVIEW_ONLY: "preview-only",
  STATIC_ONLY: "static-only",
});

export const INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES = Object.freeze({
  SOURCE_PARSE_INVALID: "source-parse-invalid",
  PROFILE_MISSING: "profile-missing",
  PROFILE_DUPLICATE: "profile-duplicate",
  PROFILE_UNSUPPORTED_VERSION: "profile-unsupported-version",
  SLOT_MISSING_REPORT_KEY: "slot-missing-report-key",
  SLOT_INVALID_REPORT_KEY: "slot-invalid-report-key",
  SLOT_DUPLICATE_REPORT_KEY: "slot-duplicate-report-key",
  SLOT_MISSING_ID: "slot-missing-id",
  SLOT_DUPLICATE_ID: "slot-duplicate-id",
  SLOT_DUPLICATE_ATTRIBUTE: "slot-duplicate-attribute",
  SLOT_UNSUPPORTED_HOST: "slot-unsupported-host",
  SLOT_UNSUPPORTED_KIND: "slot-unsupported-kind",
  SLOT_MISSING_ACCESSIBLE_NAME: "slot-missing-accessible-name",
  SLOT_DYNAMIC_OR_UNKNOWN_GEOMETRY: "slot-dynamic-or-unknown-geometry",
  SLOT_NESTED_OR_OVERLAPPING: "slot-nested-or-overlapping",
  SLOT_NON_VISUAL_RUNTIME_CONTENT: "slot-non-visual-runtime-content",
  SLOT_BUDGET_EXCEEDED: "slot-budget-exceeded",
});

export const INLINE_VISUAL_PROFILE_DIAGNOSTIC_MESSAGES = Object.freeze({
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SOURCE_PARSE_INVALID]: "页面源码无法被稳定解析为固定视觉 Profile。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_MISSING]: "页面没有声明受支持的 Report HTML Profile。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_DUPLICATE]: "页面声明了多个 Report HTML Profile。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_UNSUPPORTED_VERSION]: "页面声明的 Report HTML Profile 版本暂不支持。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_MISSING_REPORT_KEY]: "固定视觉槽位缺少稳定的 data-report-key。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_INVALID_REPORT_KEY]: "固定视觉槽位的 data-report-key 格式无效。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_REPORT_KEY]: "多个固定视觉槽位使用了同一个 data-report-key。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_MISSING_ID]: "固定视觉槽位缺少唯一 id。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_ID]: "固定视觉槽位的 id 在源码中不唯一。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_ATTRIBUTE]: "固定视觉槽位重复声明了关键 Profile 属性。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_UNSUPPORTED_HOST]: "固定视觉槽位的源码宿主不在 v0.1 允许集合中。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_UNSUPPORTED_KIND]: "固定视觉槽位必须声明 data-report-visual-kind=\"chart\"。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_MISSING_ACCESSIBLE_NAME]: "固定视觉槽位缺少可访问名称。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DYNAMIC_OR_UNKNOWN_GEOMETRY]: "固定视觉槽位没有可静态确认的固定源码几何。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_NESTED_OR_OVERLAPPING]: "固定视觉槽位不能嵌套；实际重叠会在运行期几何准入中拒绝。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_NON_VISUAL_RUNTIME_CONTENT]: "固定视觉槽位不能声明表格、表单或正文等运行态内容。",
  [INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_BUDGET_EXCEEDED]: "固定视觉槽位数量超过当前 Profile 预算。",
});

const SLOT_ATTRIBUTE = "data-report-visual-slot";
const KIND_ATTRIBUTE = "data-report-visual-kind";
const REPORT_KEY_ATTRIBUTE = "data-report-key";
const PROFILE_ATTRIBUTES = Object.freeze([
  "id",
  SLOT_ATTRIBUTE,
  KIND_ATTRIBUTE,
  REPORT_KEY_ATTRIBUTE,
  "aria-label",
  "aria-labelledby",
  "style",
]);
const ALLOWED_SLOT_HOSTS = new Set(["canvas", "div", "figure", "svg"]);
const NON_VISUAL_DESCENDANT_TAGS = new Set([
  "button",
  "form",
  "input",
  "select",
  "table",
  "tbody",
  "td",
  "textarea",
  "th",
  "thead",
  "tr",
]);
const REPORT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const CSS_POSITIVE_LENGTH_PATTERN = /^(?:(?:[1-9]\d*|\d*\.\d+)(?:px|%|rem|em|vw|vh|vmin|vmax))$/iu;
const CSS_RATIO_PATTERN = /^(?:[1-9]\d*(?:\.\d+)?|\d*\.\d+)\s*\/\s*(?:[1-9]\d*(?:\.\d+)?|\d*\.\d+)$/u;

function sourceLocation(source, offset) {
  const boundedOffset = Math.max(0, Math.min(source.length, offset));
  const preceding = source.slice(0, boundedOffset);
  const lastBreak = preceding.lastIndexOf("\n");
  return Object.freeze({
    line: preceding.split("\n").length,
    column: boundedOffset - lastBreak,
  });
}

function sourceRange(source, element) {
  return Object.freeze({
    start: sourceLocation(source, element.startTagRange.startOffset),
    end: sourceLocation(source, element.startTagRange.endOffset),
  });
}

function attributeGroup(element, name) {
  return element.attributesByName.get(name) || [];
}

function attributeValue(element, name) {
  const attributes = attributeGroup(element, name);
  if (attributes.length !== 1) return null;
  return String(attributes[0].value ?? attributes[0].rawValue ?? "");
}

function nearestReportKey(element, index) {
  let candidate = element;
  while (candidate) {
    const value = attributeValue(candidate, REPORT_KEY_ATTRIBUTE);
    if (value !== null) return value.trim();
    candidate = candidate.parentId ? index.byNodeId.get(candidate.parentId) : null;
  }
  return null;
}

function descendantsOf(element, index) {
  const descendants = [];
  const visit = (node) => {
    for (const childId of node.childElementIds || []) {
      const child = index.byNodeId.get(childId);
      if (!child) continue;
      descendants.push(child);
      visit(child);
    }
  };
  visit(element);
  return descendants;
}

function hasNestedSlot(element, index) {
  let parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
  while (parent) {
    if (attributeValue(parent, SLOT_ATTRIBUTE) === "fixed") return true;
    parent = parent.parentId ? index.byNodeId.get(parent.parentId) : null;
  }
  return false;
}

function parseInlineStyle(style) {
  const declarations = new Map();
  if (typeof style !== "string") return declarations;
  const matcher = /(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/giu;
  for (const match of style.matchAll(matcher)) {
    const property = String(match[1] || "").trim().toLowerCase();
    const value = String(match[2] || "").trim().toLowerCase();
    if (property && value && !declarations.has(property)) declarations.set(property, value);
  }
  return declarations;
}

function hasFixedInlineGeometry(element) {
  const declarations = parseInlineStyle(attributeValue(element, "style"));
  const height = declarations.get("height");
  if (height && CSS_POSITIVE_LENGTH_PATTERN.test(height)) return true;
  const minimum = declarations.get("min-height");
  const maximum = declarations.get("max-height");
  if (
    minimum
    && maximum
    && minimum === maximum
    && CSS_POSITIVE_LENGTH_PATTERN.test(minimum)
  ) return true;
  const ratio = declarations.get("aspect-ratio");
  const width = declarations.get("width");
  return Boolean(
    ratio
    && width
    && CSS_RATIO_PATTERN.test(ratio)
    && CSS_POSITIVE_LENGTH_PATTERN.test(width)
    && !declarations.has("height"),
  );
}

function hasAccessibleName(element, idCounts) {
  const ariaLabel = attributeValue(element, "aria-label")?.trim();
  if (ariaLabel) return true;
  const labelledBy = attributeValue(element, "aria-labelledby")?.trim();
  if (!labelledBy) return false;
  const references = labelledBy.split(/\s+/u).filter(Boolean);
  return references.length > 0 && references.every((id) => idCounts.get(id) === 1);
}

function freezeDiagnostic(code, element, source, reportKey = null) {
  return Object.freeze({
    code,
    location: sourceRange(source, element),
    ...(reportKey ? { reportKey } : {}),
  });
}

function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return Object.freeze(diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.location.start.line}:${diagnostic.location.start.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function countsForAttribute(index, name) {
  const counts = new Map();
  for (const element of index.elements) {
    const value = attributeValue(element, name)?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function profileDeclarations(index) {
  return index.elements.filter((element) => (
    element.tagName === "meta"
    && attributeValue(element, "name")?.trim().toLowerCase() === INLINE_VISUAL_PROFILE_META_NAME
  ));
}

function isFixedSlotCandidate(element) {
  return attributeGroup(element, SLOT_ATTRIBUTE).some((attribute) => (
    String(attribute.value ?? attribute.rawValue ?? "").trim() === "fixed"
  ));
}

function normalizeMaximumSlots(options) {
  if (options?.maximumSlots === undefined) return INLINE_VISUAL_PROFILE_DEFAULT_SLOT_LIMIT;
  const value = options.maximumSlots;
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) {
    throw new TypeError("maximumSlots must be an integer from 1 to 256.");
  }
  return value;
}

function legacyCandidates(index, source) {
  const idCounts = countsForAttribute(index, "id");
  return Object.freeze(index.elements
    .filter((element) => (
      (element.tagName === "canvas" || element.tagName === "svg")
      && attributeValue(element, "id")
      && idCounts.get(attributeValue(element, "id")) === 1
      && hasFixedInlineGeometry(element)
    ))
    .map((element) => Object.freeze({
      nodeId: element.nodeId,
      tagName: element.tagName,
      sourceRange: sourceRange(source, element),
    })));
}

/**
 * This function deliberately validates only source facts. It never executes
 * authored JavaScript, applies a CSS cascade, inspects a runtime DOM, mutates
 * source bytes, or makes a persisted compatibility decision. Any future
 * runtime proposal must still reject a Profile candidate when runtime identity
 * or geometry is not exact.
 */
export function validateInlineVisualProfile(html, options = {}) {
  const maximumSlots = normalizeMaximumSlots(options);
  const index = buildSourceIndex(String(html ?? ""));
  const source = index.source;
  const profile = profileDeclarations(index);
  const slots = index.elements.filter(isFixedSlotCandidate);
  const idCounts = countsForAttribute(index, "id");
  const reportKeyCounts = new Map();
  const slotModels = [];
  const diagnostics = [];

  const parseIsStable = index.parseErrors.length === 0 && index.rangeErrors.length === 0;
  if (!parseIsStable) {
    diagnostics.push(Object.freeze({
      code: INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SOURCE_PARSE_INVALID,
      location: Object.freeze({ start: sourceLocation(source, 0), end: sourceLocation(source, 0) }),
    }));
  }

  if (profile.length === 0) {
    diagnostics.push(Object.freeze({
      code: INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_MISSING,
      location: Object.freeze({ start: sourceLocation(source, 0), end: sourceLocation(source, 0) }),
    }));
  }
  if (profile.length > 1) {
    profile.slice(1).forEach((element) => diagnostics.push(freezeDiagnostic(
      INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_DUPLICATE,
      element,
      source,
    )));
  }
  const declaredVersion = profile.length > 0
    ? attributeValue(profile[0], "content")?.trim() || null
    : null;
  if (profile.length > 0 && declaredVersion !== INLINE_VISUAL_PROFILE_VERSION) {
    diagnostics.push(freezeDiagnostic(
      INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_UNSUPPORTED_VERSION,
      profile[0],
      source,
    ));
  }

  const slotKeys = slots.map((element) => nearestReportKey(element, index));
  slotKeys.forEach((reportKey) => {
    if (!reportKey) return;
    reportKeyCounts.set(reportKey, (reportKeyCounts.get(reportKey) || 0) + 1);
  });
  if (slots.length > maximumSlots) {
    slots.slice(maximumSlots).forEach((element) => diagnostics.push(freezeDiagnostic(
      INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_BUDGET_EXCEEDED,
      element,
      source,
      nearestReportKey(element, index),
    )));
  }

  slots.forEach((element) => {
    const reportKey = nearestReportKey(element, index);
    const slotDiagnostics = [];
    const duplicateProfileAttribute = PROFILE_ATTRIBUTES.some((name) => attributeGroup(element, name).length > 1);
    const id = attributeValue(element, "id")?.trim() || null;
    const kind = attributeValue(element, KIND_ATTRIBUTE)?.trim() || null;
    if (!reportKey) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_MISSING_REPORT_KEY);
    else if (!REPORT_KEY_PATTERN.test(reportKey)) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_INVALID_REPORT_KEY);
    else if (reportKeyCounts.get(reportKey) > 1) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_REPORT_KEY);
    if (!id) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_MISSING_ID);
    else if (idCounts.get(id) !== 1) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_ID);
    if (duplicateProfileAttribute) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_ATTRIBUTE);
    if (!ALLOWED_SLOT_HOSTS.has(element.tagName)) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_UNSUPPORTED_HOST);
    if (kind !== "chart") slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_UNSUPPORTED_KIND);
    if (!hasAccessibleName(element, idCounts)) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_MISSING_ACCESSIBLE_NAME);
    if (!hasFixedInlineGeometry(element)) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DYNAMIC_OR_UNKNOWN_GEOMETRY);
    if (hasNestedSlot(element, index)) slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_NESTED_OR_OVERLAPPING);
    if (descendantsOf(element, index).some((descendant) => NON_VISUAL_DESCENDANT_TAGS.has(descendant.tagName))) {
      slotDiagnostics.push(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_NON_VISUAL_RUNTIME_CONTENT);
    }
    slotDiagnostics.forEach((code) => diagnostics.push(freezeDiagnostic(code, element, source, reportKey)));
    slotModels.push(Object.freeze({
      nodeId: element.nodeId,
      tagName: element.tagName,
      reportKey,
      id,
      sourceRange: sourceRange(source, element),
      diagnostics: Object.freeze(slotDiagnostics),
    }));
  });

  const profileAcceptsSlots = (
    profile.length === 1
    && declaredVersion === INLINE_VISUAL_PROFILE_VERSION
    && parseIsStable
    && slots.length > 0
    && slots.length <= maximumSlots
    && slotModels.every((slot) => slot.diagnostics.length === 0)
  );
  const legacy = profile.length === 0 ? legacyCandidates(index, source) : Object.freeze([]);
  const tier = profileAcceptsSlots
    ? INLINE_VISUAL_PROFILE_TIERS.PROFILE_FIXED
    : legacy.length > 0
      ? INLINE_VISUAL_PROFILE_TIERS.LEGACY_CANDIDATE
      : profile.length > 0 || slots.length > 0
        ? INLINE_VISUAL_PROFILE_TIERS.PREVIEW_ONLY
        : INLINE_VISUAL_PROFILE_TIERS.STATIC_ONLY;

  return Object.freeze({
    contractVersion: INLINE_VISUAL_PROFILE_VERSION,
    sourceSha256: index.sourceSha256,
    tier,
    declaredVersion,
    maximumSlots,
    slots: Object.freeze(slotModels),
    legacyCandidates: legacy,
    diagnostics: uniqueDiagnostics(diagnostics),
  });
}

/**
 * This is a privacy-safe aggregate candidate only. It is not telemetry and it
 * deliberately omits source bytes, paths, URLs, slot ids, report keys and
 * source locations so a later opt-in telemetry owner cannot accidentally use
 * the source-facing validator report as an event payload.
 */
export function summarizeInlineVisualProfileForTelemetry(report) {
  if (!report || typeof report !== "object") {
    throw new TypeError("Inline visual profile report is required.");
  }
  const diagnosticCodes = [...new Set((report.diagnostics || [])
    .map((diagnostic) => diagnostic?.code)
    .filter((code) => typeof code === "string"))]
    .sort();
  const slotCount = Array.isArray(report.slots) ? report.slots.length : 0;
  return Object.freeze({
    contractVersion: report.contractVersion,
    tier: report.tier,
    slotCountBucket: slotCount === 0 ? "0" : slotCount === 1 ? "1" : slotCount <= 4 ? "2-4" : slotCount <= 16 ? "5-16" : "17+",
    diagnosticCodes: Object.freeze(diagnosticCodes),
  });
}
