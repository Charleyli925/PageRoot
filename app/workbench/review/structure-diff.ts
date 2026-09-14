import {
  reviewDisplayScopeForUnit,
  semanticElementName,
} from "./semantic-pairing";
import type {
  ReviewDisplayScope,
  ReviewSemanticPairGraph,
} from "./types";

export type StructureDifferenceStats = {
  added: string[];
  removed: string[];
  changed: boolean;
};

export function markStructureElement(
  element: Element,
  tone: string,
  semanticOwnerId: string,
  geometryOwnerId: string,
  displayScope: ReviewDisplayScope,
) {
  element.setAttribute("data-stemmio-review-structure", tone);
  element.setAttribute("data-stemmio-review-semantic-owner", semanticOwnerId);
  element.setAttribute("data-stemmio-review-geometry-owner", geometryOwnerId);
  element.setAttribute("data-stemmio-review-display-group", `display-${semanticOwnerId}`);
  element.setAttribute("data-stemmio-review-display-owner", `display-owner-${semanticOwnerId}`);
  element.setAttribute("data-stemmio-review-display-scope", displayScope);
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
    if (beforeElement?.hasAttribute("data-stemmio-review-structure")
      || afterElement?.hasAttribute("data-stemmio-review-structure")) {
      stats.changed = true;
    }
    const stableCommon = beforeElement?.getAttribute("data-stemmio-review-stable-common") === "true"
      || afterElement?.getAttribute("data-stemmio-review-stable-common") === "true";
    if (!beforeElement && afterElement && ownsElement && !stableCommon) {
      markStructureElement(
        afterElement,
        "added",
        pair.semanticOwnerId,
        pair.geometryOwnerId,
        reviewDisplayScopeForUnit(pair.after!),
      );
      stats.added.push(semanticElementName(afterElement));
    } else if (beforeElement && !afterElement && ownsElement && !stableCommon) {
      markStructureElement(
        beforeElement,
        "removed",
        pair.semanticOwnerId,
        pair.geometryOwnerId,
        reviewDisplayScopeForUnit(pair.before!),
      );
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
