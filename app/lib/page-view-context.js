import { buildSourceIndex } from "./source-index.js";
import {
  createTargetRef,
  resolveTargetRef,
} from "./target-resolver.js";

export const PAGE_VIEW_CONTEXT_PROTOCOL = "pageroot-page-view-context";
export const PAGE_VIEW_CONTEXT_VERSION = 1;

const MAX_SNAPSHOT_ENTRIES = 512;
const MAX_CONTEXT_ENTRIES = 64;
const MAX_CLASS_TOKENS = 128;
const MAX_QUALIFIED_CLASS_TOKENS = 8;
const MAX_CLASS_TOKEN_LENGTH = 96;
const EXCLUDED_TAGS = new Set([
  "html",
  "head",
  "body",
  "script",
  "style",
  "link",
  "meta",
  "base",
]);

function classTokens(value) {
  return String(value ?? "")
    .split(/[\t\n\f\r ]+/u)
    .filter((token) => (
      token.length > 0
      && token.length <= MAX_CLASS_TOKEN_LENGTH
      && !/[\u0000-\u001f\u007f]/u.test(token)
    ))
    .slice(0, MAX_CLASS_TOKENS);
}

function singleSourceAttribute(element, name) {
  const attributes = element.attributesByName.get(name) ?? [];
  if (attributes.length > 1) return { valid: false, present: false, value: null };
  if (attributes.length === 0) return { valid: true, present: false, value: null };
  return {
    valid: true,
    present: true,
    value: attributes[0].value ?? attributes[0].rawValue ?? "",
  };
}

function sourcePresentationState(element) {
  const classAttribute = singleSourceAttribute(element, "class");
  const hiddenAttribute = singleSourceAttribute(element, "hidden");
  const openAttribute = singleSourceAttribute(element, "open");
  const ariaSelectedAttribute = singleSourceAttribute(element, "aria-selected");
  const ariaExpandedAttribute = singleSourceAttribute(element, "aria-expanded");
  if (
    !classAttribute.valid
    || !hiddenAttribute.valid
    || !openAttribute.valid
    || !ariaSelectedAttribute.valid
    || !ariaExpandedAttribute.valid
  ) return null;
  return {
    classTokens: classTokens(classAttribute.value),
    hidden: hiddenAttribute.present,
    open: openAttribute.present,
    ariaSelected: ariaSelectedAttribute.present
      ? String(ariaSelectedAttribute.value)
      : null,
    ariaExpanded: ariaExpandedAttribute.present
      ? String(ariaExpandedAttribute.value)
      : null,
  };
}

function normalizedAriaBoolean(value) {
  if (value === null) return null;
  return value === "true" || value === "false" ? value : undefined;
}

function currentPresentationState(rawEntry) {
  if (
    typeof rawEntry?.className !== "string"
    || typeof rawEntry?.hidden !== "boolean"
    || typeof rawEntry?.open !== "boolean"
  ) return null;
  const ariaSelected = normalizedAriaBoolean(rawEntry.ariaSelected ?? null);
  const ariaExpanded = normalizedAriaBoolean(rawEntry.ariaExpanded ?? null);
  if (ariaSelected === undefined || ariaExpanded === undefined) return null;
  return {
    classTokens: classTokens(rawEntry.className),
    hidden: rawEntry.hidden,
    open: rawEntry.open,
    ariaSelected,
    ariaExpanded,
    visible: (
      rawEntry.hidden !== true
      && String(rawEntry.display ?? "").toLowerCase() !== "none"
      && !["hidden", "collapse"].includes(
        String(rawEntry.visibility ?? "").toLowerCase(),
      )
    ),
  };
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function frozenTargetRef(targetRef) {
  return Object.freeze({
    ...targetRef,
    sourceAnchor: targetRef.sourceAnchor
      ? Object.freeze({ ...targetRef.sourceAnchor })
      : undefined,
    fingerprint: targetRef.fingerprint
      ? Object.freeze({
          ...targetRef.fingerprint,
          stableAttributes: Object.freeze({
            ...(targetRef.fingerprint.stableAttributes ?? {}),
          }),
          ancestorFingerprint: Object.freeze([
            ...(targetRef.fingerprint.ancestorFingerprint ?? []),
          ]),
        })
      : undefined,
  });
}

function contextStateDiff(sourceState, currentState) {
  const hidden = sourceState.hidden === currentState.hidden
    ? undefined
    : currentState.hidden;
  const open = sourceState.open === currentState.open
    ? undefined
    : currentState.open;
  const ariaSelected = sourceState.ariaSelected === currentState.ariaSelected
    ? undefined
    : currentState.ariaSelected;
  const ariaExpanded = sourceState.ariaExpanded === currentState.ariaExpanded
    ? undefined
    : currentState.ariaExpanded;
  return {
    classAdd: difference(currentState.classTokens, sourceState.classTokens),
    classRemove: difference(sourceState.classTokens, currentState.classTokens),
    hidden,
    open,
    ariaSelected,
    ariaExpanded,
  };
}

function hasSemanticState(diff) {
  return diff.hidden !== undefined
    || diff.open !== undefined
    || diff.ariaSelected !== undefined
    || diff.ariaExpanded !== undefined;
}

function qualifyingClassTokens(candidates) {
  const changes = new Map();
  for (const candidate of candidates) {
    for (const token of candidate.diff.classAdd) {
      const change = changes.get(token) ?? {
        added: 0,
        removed: 0,
        visibility: new Set(),
      };
      change.added += 1;
      change.visibility.add(candidate.currentState.visible);
      changes.set(token, change);
    }
    for (const token of candidate.diff.classRemove) {
      const change = changes.get(token) ?? {
        added: 0,
        removed: 0,
        visibility: new Set(),
      };
      change.removed += 1;
      change.visibility.add(candidate.currentState.visible);
      changes.set(token, change);
    }
  }
  return new Set(
    [...changes.entries()]
      .filter(([, change]) => (
        change.added > 0
        && change.removed > 0
        && change.visibility.has(true)
        && change.visibility.has(false)
      ))
      .slice(0, MAX_QUALIFIED_CLASS_TOKENS)
      .map(([token]) => token),
  );
}

export function createPageViewContext({
  html,
  documentKey,
  generation,
  snapshot,
} = {}) {
  if (
    typeof html !== "string"
    || typeof documentKey !== "string"
    || documentKey.length === 0
    || documentKey.length > 8192
    || !Number.isInteger(generation)
    || generation < 0
    || snapshot?.protocol !== PAGE_VIEW_CONTEXT_PROTOCOL
    || snapshot?.version !== PAGE_VIEW_CONTEXT_VERSION
    || snapshot?.truncated === true
    || !Array.isArray(snapshot?.entries)
    || snapshot.entries.length > MAX_SNAPSHOT_ENTRIES
  ) return null;

  const sourceIndex = buildSourceIndex(html);
  if (snapshot.sourceSha256 !== sourceIndex.sourceSha256) return null;

  const sourceNodeCounts = new Map();
  for (const rawEntry of snapshot.entries) {
    const sourceNodeId = String(rawEntry?.sourceNodeId ?? "");
    sourceNodeCounts.set(sourceNodeId, (sourceNodeCounts.get(sourceNodeId) ?? 0) + 1);
  }

  const candidates = [];
  for (const rawEntry of snapshot.entries) {
    const sourceNodeId = String(rawEntry?.sourceNodeId ?? "");
    if (!sourceNodeId || sourceNodeCounts.get(sourceNodeId) !== 1) continue;
    const element = sourceIndex.byNodeId.get(sourceNodeId);
    if (
      !element
      || element.type !== "element"
      || EXCLUDED_TAGS.has(element.tagName)
    ) continue;
    const sourceState = sourcePresentationState(element);
    const currentState = currentPresentationState(rawEntry);
    if (!sourceState || !currentState) continue;
    const diff = contextStateDiff(sourceState, currentState);
    if (
      diff.classAdd.length === 0
      && diff.classRemove.length === 0
      && !hasSemanticState(diff)
    ) continue;
    candidates.push({
      element,
      currentState,
      diff,
    });
  }

  const allowedClassTokens = qualifyingClassTokens(candidates);
  const entries = [];
  for (const candidate of candidates) {
    const classAdd = candidate.diff.classAdd.filter(
      (token) => allowedClassTokens.has(token),
    );
    const classRemove = candidate.diff.classRemove.filter(
      (token) => allowedClassTokens.has(token),
    );
    if (
      classAdd.length === 0
      && classRemove.length === 0
      && !hasSemanticState(candidate.diff)
    ) continue;
    const targetRef = createTargetRef(sourceIndex, candidate.element, {
      level: "subregion",
    });
    entries.push(Object.freeze({
      targetRef: frozenTargetRef(targetRef),
      classAdd: Object.freeze(classAdd),
      classRemove: Object.freeze(classRemove),
      ...(candidate.diff.hidden !== undefined
        ? { hidden: candidate.diff.hidden }
        : {}),
      ...(candidate.diff.open !== undefined
        ? { open: candidate.diff.open }
        : {}),
      ...(candidate.diff.ariaSelected !== undefined
        ? { ariaSelected: candidate.diff.ariaSelected }
        : {}),
      ...(candidate.diff.ariaExpanded !== undefined
        ? { ariaExpanded: candidate.diff.ariaExpanded }
        : {}),
    }));
    if (entries.length >= MAX_CONTEXT_ENTRIES) break;
  }

  if (entries.length === 0) return null;
  return Object.freeze({
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    entries: Object.freeze(entries),
  });
}

export function resolvePageViewContext(html, context) {
  const sourceIndex = buildSourceIndex(html);
  if (
    context?.protocol !== PAGE_VIEW_CONTEXT_PROTOCOL
    || context?.version !== PAGE_VIEW_CONTEXT_VERSION
    || !Array.isArray(context?.entries)
    || context.entries.length > MAX_CONTEXT_ENTRIES
  ) {
    return { sourceIndex, entries: [] };
  }
  const entries = [];
  for (const entry of context.entries) {
    let resolution;
    try {
      resolution = resolveTargetRef(sourceIndex, entry.targetRef);
    } catch {
      continue;
    }
    if (
      !["exact", "rebound"].includes(resolution.resolution)
      || resolution.target?.type !== "element"
    ) continue;
    const sourceState = sourcePresentationState(resolution.target);
    if (!sourceState) continue;
    entries.push({
      entry,
      sourceNodeId: resolution.target.nodeId,
      resolution: resolution.resolution,
      sourceState,
    });
  }
  return { sourceIndex, entries };
}
