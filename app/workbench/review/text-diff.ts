import {
  mergeReviewTextRanges,
  readableReviewTextFootprintPlan,
  sentenceAwareTextDifferences,
} from "../../lib/review-text-diff.js";
import {
  flattenReviewSemanticPairs,
} from "./semantic-pairing";
import {
  sameBreakLayout,
} from "./parse";
import type {
  ReviewSemanticPairGraph,
  ReviewSemanticPairNode,
  ReviewSemanticUnit,
  ReviewTextEvidenceGroup,
  ReviewTextInventory,
  TextRange,
} from "./types";

export function markTextAnchor(anchor: Element, groupId: string, offset: number) {
  const attribute = "data-pageroot-review-text-anchors";
  const anchors = new Set(
    (anchor.getAttribute(attribute) || "").split(/\s+/).filter(Boolean),
  );
  anchors.add(`${groupId}@${Math.max(0, Math.trunc(offset))}`);
  anchor.setAttribute(attribute, [...anchors].join(" "));
}

export function reviewTextAnchorOffset(
  anchor: Element,
  inventory: ReviewTextInventory,
): number {
  const firstEntry = inventory.nodes[0];
  if (!firstEntry) return 0;
  const ownerId = anchor.getAttribute("data-pageroot-review-geometry-owner") || "";
  let offset = 0;
  const walker = anchor.ownerDocument.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    let nestedOwner = parent;
    let crossesOwner = false;
    while (nestedOwner && nestedOwner !== anchor) {
      const nestedOwnerId = nestedOwner.getAttribute("data-pageroot-review-geometry-owner") || "";
      if (nestedOwnerId && nestedOwnerId !== ownerId) {
        crossesOwner = true;
        break;
      }
      nestedOwner = nestedOwner.parentElement;
    }
    const visibleTextNode = Boolean(
      parent
      && !crossesOwner
      && parent.namespaceURI === "http://www.w3.org/1999/xhtml"
      && !parent.closest("script, style, noscript, template, [data-pageroot-review-projection-layer]"),
    );
    if (visibleTextNode) {
      if (node === firstEntry.node) return offset + firstEntry.nodeOffset;
      offset += node.textContent?.length || 0;
    }
    node = walker.nextNode();
  }
  return 0;
}

export function applyTextFootprintMetadata(
  marker: HTMLElement,
  group: ReviewTextEvidenceGroup,
) {
  marker.dataset.pagerootReviewTextGroup = group.id;
  marker.dataset.pagerootReviewTextOperation = group.operation;
  marker.dataset.pagerootReviewSemanticOwner = group.semanticOwnerId;
  marker.dataset.pagerootReviewGeometryOwner = group.geometryOwnerId;
}

export function wrapTextRanges(
  inventory: ReviewTextInventory,
  groups: ReviewTextEvidenceGroup[],
  tone: "removed" | "added",
) {
  if (!groups.length) return;
  const annotatedRanges = groups.flatMap((group) => (
    mergeReviewTextRanges(group.ranges).map((range) => ({ ...range, group }))
  )).sort((left, right) => left.start - right.start || left.end - right.end);
  inventory.nodes.forEach(({ node, start, end, nodeOffset }) => {
    const intersections = annotatedRanges
      .map((range) => ({
        start: Math.max(start, range.start),
        end: Math.min(end, range.end),
        group: range.group,
      }))
      .filter((range) => range.end > range.start);
    if (!intersections.length) return;
    const source = node.textContent || "";
    const fragment = node.ownerDocument.createDocumentFragment();
    const appendDifference = (value: string, group: ReviewTextEvidenceGroup) => {
      if (!value) return;
      const marker = node.ownerDocument.createElement("span");
      marker.dataset.pagerootReviewText = tone;
      applyTextFootprintMetadata(marker, group);
      marker.textContent = value;
      fragment.append(marker);
    };
    let cursor = 0;
    intersections.forEach((range) => {
      const localStart = nodeOffset + range.start - start;
      const localEnd = nodeOffset + range.end - start;
      if (localStart > cursor) {
        fragment.append(source.slice(cursor, localStart));
      }
      appendDifference(source.slice(localStart, localEnd), range.group);
      cursor = localEnd;
    });
    if (cursor < source.length) {
      fragment.append(source.slice(cursor));
    }
    node.replaceWith(fragment);
  });
}

export function markSemanticTextFootprintOwner(
  unit: ReviewSemanticUnit,
  groups: ReviewTextEvidenceGroup[],
) {
  unit.element.setAttribute(
    "data-pageroot-review-geometry-owner",
    groups[0]?.geometryOwnerId || "",
  );
}

export function markSemanticAllText(
  pair: ReviewSemanticPairNode,
  unit: ReviewSemanticUnit,
  tone: "removed" | "added",
  groupId: string,
): boolean {
  const inventory = unit.inventory;
  if (!inventory?.text.trim()) return false;
  const differences = tone === "added"
    ? { before: [], after: [{ start: 0, end: inventory.text.length }] }
    : { before: [{ start: 0, end: inventory.text.length }], after: [] };
  const plan = readableReviewTextFootprintPlan(
    tone === "added" ? "" : inventory.text,
    tone === "added" ? inventory.text : "",
    differences,
  );
  const side = tone === "added" ? plan.after : plan.before;
  const group: ReviewTextEvidenceGroup = {
    id: groupId,
    ranges: side.phraseGroups.flat(),
    operation: plan.operation,
    semanticOwnerId: pair.semanticOwnerId,
    geometryOwnerId: pair.geometryOwnerId,
  };
  markSemanticTextFootprintOwner(unit, [group]);
  wrapTextRanges(inventory, [group], tone);
  return true;
}

export function markSemanticTextDifferences(graph: ReviewSemanticPairGraph): {
  changed: boolean;
} {
  let changed = false;
  let groupSequence = 0;
  flattenReviewSemanticPairs(graph.root).forEach((pair) => {
    const beforeInventory = pair.before?.inventory || null;
    const afterInventory = pair.after?.inventory || null;
    if (!beforeInventory && !afterInventory) return;
    const groupBase = `text-${++groupSequence}`;
    if (!beforeInventory && pair.after) {
      changed = markSemanticAllText(pair, pair.after, "added", `${groupBase}-1`) || changed;
      return;
    }
    if (!afterInventory && pair.before) {
      changed = markSemanticAllText(pair, pair.before, "removed", `${groupBase}-1`) || changed;
      return;
    }
    if (!beforeInventory || !afterInventory || !pair.before || !pair.after) return;
    const layoutChanged = !sameBreakLayout(beforeInventory, afterInventory);
    const differences = beforeInventory.text === afterInventory.text
      ? { before: [], after: [] }
      : sentenceAwareTextDifferences(beforeInventory.text, afterInventory.text);
    const plan = readableReviewTextFootprintPlan(
      beforeInventory.text,
      afterInventory.text,
      { ...differences, layout: layoutChanged },
    );
    if (plan.operation === "none") return;
    if (plan.operation === "layout") {
      return;
    }
    const createGroups = (
      ranges: TextRange[][],
      geometryOwnerId: string,
    ): ReviewTextEvidenceGroup[] => ranges.map((groupRanges, index) => ({
      id: `${groupBase}-${index + 1}`,
      ranges: groupRanges,
      operation: plan.operation,
      semanticOwnerId: pair.semanticOwnerId,
      geometryOwnerId,
    }));
    const beforeGroups = createGroups(plan.before.phraseGroups, pair.geometryOwnerId);
    const afterGroups = createGroups(plan.after.phraseGroups, pair.geometryOwnerId);
    if (beforeGroups.length) {
      markSemanticTextFootprintOwner(pair.before, beforeGroups);
      wrapTextRanges(beforeInventory, beforeGroups, "removed");
      changed = true;
    } else if (plan.before.anchorOffset !== null) {
      markTextAnchor(
        pair.before.element,
        `${groupBase}-1`,
        reviewTextAnchorOffset(pair.before.element, beforeInventory) + plan.before.anchorOffset,
      );
    }
    if (afterGroups.length) {
      markSemanticTextFootprintOwner(pair.after, afterGroups);
      wrapTextRanges(afterInventory, afterGroups, "added");
      changed = true;
    } else if (plan.after.anchorOffset !== null) {
      markTextAnchor(
        pair.after.element,
        `${groupBase}-1`,
        reviewTextAnchorOffset(pair.after.element, afterInventory) + plan.after.anchorOffset,
      );
    }
  });
  return { changed };
}
