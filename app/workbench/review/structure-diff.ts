import {
  semanticElementName,
} from "./semantic-pairing";
import type {
  ReviewSemanticPairGraph,
} from "./types";

export type StructureDifferenceStats = {
  added: string[];
  removed: string[];
};

export function markStructureElement(element: Element, tone: string, semanticOwnerId: string) {
  element.setAttribute("data-pageroot-review-structure", tone);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
}

export function* markStructureDifferenceSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", boolean, void> {
  const stats: StructureDifferenceStats = { added: [], removed: [] };
  const pending = [graph.root];
  let inspected = 0;
  while (pending.length) {
    const pair = pending.pop()!;
    inspected += 1;
    const beforeElement = pair.before?.element || null;
    const afterElement = pair.after?.element || null;
    const unitKind = pair.before?.kind || pair.after?.kind || "";
    const ownsElement = unitKind !== "direct-flow" && unitKind !== "br-line";
    if (!beforeElement && afterElement && ownsElement) {
      markStructureElement(afterElement, "added", pair.semanticOwnerId);
      stats.added.push(semanticElementName(afterElement));
    } else if (beforeElement && !afterElement && ownsElement) {
      markStructureElement(beforeElement, "removed", pair.semanticOwnerId);
      stats.removed.push(semanticElementName(beforeElement));
    } else if (beforeElement && afterElement) {
      for (let index = pair.children.length - 1; index >= 0; index -= 1) {
        pending.push(pair.children[index]);
      }
    }
    if (inspected % 24 === 0) yield "semantic-row";
  }
  return Object.values(stats).some((entries) => entries.length > 0);
}
