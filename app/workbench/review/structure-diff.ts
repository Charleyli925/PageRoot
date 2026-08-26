import {
  exactSubtreeSignature,
  selfCompatibilitySignature,
} from "./parse";
import {
  semanticElementName,
} from "./semantic-pairing";
import type {
  ReviewSemanticPairGraph,
  ReviewSignatureCache,
} from "./types";

export type StructureDifferenceStats = {
  added: string[];
  removed: string[];
  moved: string[];
  replaced: string[];
};

export function structuralSelfSignature(
  element: Element,
  signatures: ReviewSignatureCache,
): string {
  return selfCompatibilitySignature(element, signatures);
}

export function markStructureElement(element: Element, tone: string, semanticOwnerId: string) {
  element.setAttribute("data-pageroot-review-structure", tone);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
}

export function* markStructureDifferenceSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", boolean, void> {
  const stats: StructureDifferenceStats = { added: [], removed: [], moved: [], replaced: [] };
  const pending = [graph.root];
  let inspected = 0;
  while (pending.length) {
    const pair = pending.pop()!;
    inspected += 1;
    const beforeElement = pair.before?.element || null;
    const afterElement = pair.after?.element || null;
    if (!beforeElement && afterElement) {
      markStructureElement(afterElement, "added", pair.semanticOwnerId);
      stats.added.push(semanticElementName(afterElement));
    } else if (beforeElement && !afterElement) {
      markStructureElement(beforeElement, "removed", pair.semanticOwnerId);
      stats.removed.push(semanticElementName(beforeElement));
    } else if (beforeElement && afterElement && pair.before && pair.after) {
      if (pair.moved) {
        markStructureElement(beforeElement, "from", pair.semanticOwnerId);
        markStructureElement(afterElement, "to", pair.semanticOwnerId);
        stats.moved.push(semanticElementName(afterElement));
      }
      // Equality is a subtree property. A mismatch only tells us to continue
      // through the already paired hierarchy; it never turns the ancestor
      // itself into a structural replacement.
      if (exactSubtreeSignature(beforeElement, graph.signatures)
        !== exactSubtreeSignature(afterElement, graph.signatures)) {
        if (pair.structureFallback) {
          markStructureElement(beforeElement, "before", pair.semanticOwnerId);
          markStructureElement(afterElement, "after", pair.semanticOwnerId);
          stats.replaced.push(semanticElementName(afterElement));
        } else {
          const ownsStructuralElement = pair.before.kind !== "direct-flow"
            && pair.before.kind !== "br-line";
          if (
            ownsStructuralElement
            && structuralSelfSignature(beforeElement, graph.signatures)
              !== structuralSelfSignature(afterElement, graph.signatures)
          ) {
            markStructureElement(beforeElement, "before", pair.semanticOwnerId);
            markStructureElement(afterElement, "after", pair.semanticOwnerId);
            stats.replaced.push(semanticElementName(afterElement));
          }
          for (let index = pair.children.length - 1; index >= 0; index -= 1) {
            pending.push(pair.children[index]);
          }
        }
      }
    }
    if (inspected % 24 === 0) yield "semantic-row";
  }
  return Object.values(stats).some((entries) => entries.length > 0);
}
