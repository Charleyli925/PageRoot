import { buildSourceIndex } from "../../lib/source-index.js";
import { analyzeReviewStableIdTopology } from "../../lib/review-stable-id-diff.js";

const VISUAL_ONLY_KINDS = new Set(["style"]);
const DETERMINISTIC_KINDS = new Set([
  "text", "added", "removed", "moved", "reordered", "attribute",
]);

function sourceElementMap(html) {
  const index = buildSourceIndex(html);
  return { index, elements: index.byPagerootId };
}

function comparableAttributes(element, excluded = new Set()) {
  return element.attributes
    .filter((attribute) => (
      !excluded.has(attribute.name)
      && !attribute.name.startsWith("data-pageroot-")
    ))
    .map((attribute) => `${attribute.name}=${attribute.value ?? attribute.rawValue ?? ""}`)
    .sort()
    .join("\u001f");
}

function parentPagerootId(index, element) {
  const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
  return parent?.type === "element" ? parent.pagerootId : null;
}

function isPageSourceElement(element) {
  return element.tagName === "style"
    || element.tagName === "script"
    || (element.tagName === "link" && /(?:^|\s)stylesheet(?:\s|$)/iu.test(
      element.attributesByName.get("rel")?.[0]?.value || "",
    ));
}

function topologyDescriptors(index) {
  return index.elements.flatMap((element) => element.pagerootId ? [{
    id: element.pagerootId,
    parentId: parentPagerootId(index, element),
    index: element.siblingIndex,
  }] : []);
}

function outermost(element, changedIds, index) {
  for (let parentId = element.parentId; parentId;) {
    const parent = index.byNodeId.get(parentId);
    if (!parent || parent.type !== "element") break;
    if (parent.pagerootId && changedIds.has(parent.pagerootId)) return false;
    parentId = parent.parentId;
  }
  return true;
}

function evidenceTypes(kinds) {
  const text = kinds.includes("text");
  const structure = kinds.some((kind) => kind !== "text");
  return [...(text ? ["text"] : []), ...(structure || !text ? ["structure"] : [])];
}

export function hasReviewSourceCandidate(evidence) {
  return evidence.kinds.length > 0;
}

export function hasDeterministicReviewSourceEvidence(evidence) {
  return evidence.kinds.some((kind) => DETERMINISTIC_KINDS.has(kind));
}

export function isVisualOnlyReviewSourceEvidence(evidence) {
  return evidence.kinds.length > 0
    && evidence.kinds.every((kind) => VISUAL_ONLY_KINDS.has(kind));
}

/** Candidate discovery only; this function never declares a visual change. */
export function buildReviewVisualEvidence(beforeHtml, afterHtml, sessionId) {
  const before = sourceElementMap(beforeHtml);
  const after = sourceElementMap(afterHtml);
  const beforeIdentity = before.index.pagerootIdentity;
  const afterIdentity = after.index.pagerootIdentity;
  const binding = {
    sessionId,
    sourceHash: {
      before: before.index.sourceSha256,
      after: after.index.sourceSha256,
    },
    identity: beforeIdentity?.complete && beforeIdentity.valid
      && afterIdentity?.complete && afterIdentity.valid
      ? "supported"
      : "unsupported",
  };
  if (binding.identity === "unsupported") {
    binding.reason = `Stable ID identity is ${beforeIdentity?.status || "unknown"}/${afterIdentity?.status || "unknown"}`;
    return { binding, evidence: [] };
  }

  const topology = analyzeReviewStableIdTopology(
    topologyDescriptors(before.index),
    topologyDescriptors(after.index),
  );
  const moved = new Set(topology.movedIds);
  const removed = new Set(topology.removedIds);
  const added = new Set(topology.addedIds);
  const evidence = [];

  for (const id of topology.commonIds) {
    const beforeElement = before.elements.get(id);
    const afterElement = after.elements.get(id);
    if (isPageSourceElement(beforeElement) || isPageSourceElement(afterElement)) continue;
    const kinds = [];
    if (beforeElement.directText !== afterElement.directText) kinds.push("text");
    if (moved.has(id)) kinds.push("moved");
    if ((beforeElement.attributesByName.get("style")?.[0]?.value || "")
      !== (afterElement.attributesByName.get("style")?.[0]?.value || "")) kinds.push("style");
    if (
      beforeElement.namespaceURI !== afterElement.namespaceURI
      || beforeElement.tagName !== afterElement.tagName
      || comparableAttributes(beforeElement, new Set(["style"]))
        !== comparableAttributes(afterElement, new Set(["style"]))
    ) kinds.push("attribute");
    if (!kinds.length) continue;
    evidence.push({
      id: `candidate-${id}`,
      stableId: id,
      parentStableId: parentPagerootId(after.index, afterElement),
      kinds: [...new Set(kinds)],
      types: evidenceTypes(kinds),
      beforePresent: true,
      afterPresent: true,
    });
  }

  for (const range of topology.reorderedRanges) {
    if (!range.parentId || !topology.commonIds.includes(range.parentId)) continue;
    const parent = after.elements.get(range.parentId);
    if (!parent) continue;
    const existing = evidence.find((entry) => entry.stableId === range.parentId);
    if (existing) {
      existing.kinds = [...new Set([...existing.kinds, "reordered"])];
      existing.types = evidenceTypes(existing.kinds);
      continue;
    }
    evidence.push({
      id: `candidate-${range.parentId}`,
      stableId: range.parentId,
      parentStableId: parentPagerootId(after.index, parent),
      kinds: ["reordered"],
      types: ["structure"],
      beforePresent: true,
      afterPresent: true,
    });
  }

  for (const id of topology.removedIds) {
    const element = before.elements.get(id);
    if (!element || isPageSourceElement(element) || !outermost(element, removed, before.index)) continue;
    evidence.push({
      id: `candidate-${id}`,
      stableId: id,
      parentStableId: parentPagerootId(before.index, element),
      kinds: ["removed"],
      types: ["structure"],
      beforePresent: true,
      afterPresent: false,
    });
  }
  for (const id of topology.addedIds) {
    const element = after.elements.get(id);
    if (!element || isPageSourceElement(element) || !outermost(element, added, after.index)) continue;
    evidence.push({
      id: `candidate-${id}`,
      stableId: id,
      parentStableId: parentPagerootId(after.index, element),
      kinds: ["added"],
      types: ["structure"],
      beforePresent: false,
      afterPresent: true,
    });
  }
  return { binding, evidence };
}

function observationMatches(observation, side, stableId, binding, generation) {
  return Boolean(
    observation
    && observation.sessionId === binding.sessionId
    && observation.side === side
    && observation.sourceHash === binding.sourceHash[side]
    && observation.generation === generation
    && observation.stableId === stableId
    && observation.unverified !== true,
  );
}

/** Missing, stale, unstable or one-sided evidence is never unchanged. */
export function reviewVisualVerdict(evidence, before, after, binding, generation) {
  if (binding.identity !== "supported") {
    return "unverified";
  }
  if (evidence.kinds.includes("added")) {
    if (!observationMatches(after, "after", evidence.stableId, binding, generation)) {
      return "unverified";
    }
    return after.visible ? "changed" : "unverified";
  }
  if (evidence.kinds.includes("removed")) {
    if (!observationMatches(before, "before", evidence.stableId, binding, generation)) {
      return "unverified";
    }
    return before.visible ? "changed" : "unverified";
  }
  if (
    !observationMatches(before, "before", evidence.stableId, binding, generation)
    || !observationMatches(after, "after", evidence.stableId, binding, generation)
  ) return "unverified";
  if (!before.visible && !after.visible) return "unverified";
  if (before.visible !== after.visible) {
    return hasReviewSourceCandidate(evidence) ? "changed" : "unverified";
  }
  if (!before.fingerprint || !after.fingerprint) return "unverified";
  if (before.fingerprint === after.fingerprint) {
    // Inline style remains a concrete element-level source fact. Observation
    // is diagnostic only and never creates a page-level user-visible claim.
    return isVisualOnlyReviewSourceEvidence(evidence) ? "unverified" : "unchanged";
  }
  return hasReviewSourceCandidate(evidence) ? "changed" : "unverified";
}
