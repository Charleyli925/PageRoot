import {
  semanticElementName,
} from "./semantic-pairing";
import type {
  ReviewSemanticPairGraph,
} from "./types";

export type StructureDifferenceStats = {
  added: string[];
  removed: string[];
  changed: boolean;
};

export function markStructureElement(element: Element, tone: string, semanticOwnerId: string) {
  element.setAttribute("data-pageroot-review-structure", tone);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
}

export function* markStructureDifferenceSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", boolean, void> {
  const stats: StructureDifferenceStats = { added: [], removed: [], changed: false };
  const pending = [graph.root];
  let inspected = 0;
  while (pending.length) {
    const pair = pending.pop()!;
    inspected += 1;
    const beforeElement = pair.before?.element || null;
    const afterElement = pair.after?.element || null;
    const unitKind = pair.before?.kind || pair.after?.kind || "";
    const ownsElement = unitKind !== "direct-flow" && unitKind !== "br-line";
    if (beforeElement?.hasAttribute("data-pageroot-review-structure")
      || afterElement?.hasAttribute("data-pageroot-review-structure")) {
      stats.changed = true;
    }
    const stableCommon = beforeElement?.getAttribute("data-pageroot-review-stable-common") === "true"
      || afterElement?.getAttribute("data-pageroot-review-stable-common") === "true";
    if (!beforeElement && afterElement && ownsElement && !stableCommon) {
      markStructureElement(afterElement, "added", pair.semanticOwnerId);
      stats.added.push(semanticElementName(afterElement));
    } else if (beforeElement && !afterElement && ownsElement && !stableCommon) {
      markStructureElement(beforeElement, "removed", pair.semanticOwnerId);
      stats.removed.push(semanticElementName(beforeElement));
    } else if ((beforeElement && afterElement) || stableCommon) {
      for (let index = pair.children.length - 1; index >= 0; index -= 1) {
        pending.push(pair.children[index]);
      }
    }
    if (inspected % 24 === 0) yield "semantic-row";
  }
  return stats.changed || stats.added.length > 0 || stats.removed.length > 0;
}
