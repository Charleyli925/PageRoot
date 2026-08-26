import { readableReviewTextFootprintPlan } from "../../lib/review-text-diff.js";
import type {
  ReviewTextChangeOperation,
} from "../../lib/review-text-diff.js";
import {
  appendProjectionFactToElement,
  normalizedCss,
  sameBreakLayout,
  VISUAL_ATTRIBUTE_NAMES,
} from "./parse";
import {
  alignElementSiblings,
  flattenReviewSemanticPairs,
  pairedVisualElements,
  selfPresentationSignature,
} from "./semantic-pairing";
import type {
  ReviewSemanticPairGraph,
  ReviewSemanticPairNode,
  ReviewSemanticUnit,
} from "./types";

export const styleDeclarationCache = new Map<string, Map<string, string>>();
export const stylesheetRuleCache = new WeakMap<Document, Map<string, string>>();
export const changedStylesheetSelectorCache = new WeakMap<
  Document,
  WeakMap<Document, Array<{ selector: string; labels: string[] }>>
>();

export function styleDeclarationMap(value: string): Map<string, string> {
  const cached = styleDeclarationCache.get(value);
  if (cached) return cached;
  const declarations = new Map<string, string>();
  value.split(";").forEach((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator <= 0) return;
    declarations.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      normalizedCss(declaration.slice(separator + 1)),
    );
  });
  styleDeclarationCache.set(value, declarations);
  if (styleDeclarationCache.size > 256) {
    styleDeclarationCache.delete(styleDeclarationCache.keys().next().value as string);
  }
  return declarations;
}

export function stylesheetRules(document: Document): Map<string, string> {
  const cached = stylesheetRuleCache.get(document);
  if (cached) return cached;
  const rules = new Map<string, string>();
  document.querySelectorAll("style").forEach((styleElement) => {
    const css = styleElement.textContent || "";
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selector = normalizedCss(match[1]);
      if (!selector || selector.startsWith("@")) continue;
      rules.set(selector, normalizedCss(match[2]));
    }
  });
  stylesheetRuleCache.set(document, rules);
  return rules;
}

export function changedStylesheetSelectors(before: Document, after: Document) {
  const cached = changedStylesheetSelectorCache.get(before)?.get(after);
  if (cached) return cached;
  const beforeRules = stylesheetRules(before);
  const afterRules = stylesheetRules(after);
  const changes = [...new Set([...beforeRules.keys(), ...afterRules.keys()])]
    .filter((selector) => beforeRules.get(selector) !== afterRules.get(selector))
    .map((selector) => {
      const beforeDeclarations = styleDeclarationMap(beforeRules.get(selector) || "");
      const afterDeclarations = styleDeclarationMap(afterRules.get(selector) || "");
      return {
        selector,
        labels: [...new Set([
          ...beforeDeclarations.keys(),
          ...afterDeclarations.keys(),
        ])].filter((property) => (
          beforeDeclarations.get(property) !== afterDeclarations.get(property)
        )),
      };
    });
  const afterCache = changedStylesheetSelectorCache.get(before)
    ?? new WeakMap<Document, Array<{ selector: string; labels: string[] }>>();
  afterCache.set(after, changes);
  changedStylesheetSelectorCache.set(before, afterCache);
  return changes;
}

export type ReviewStyleScope = "box" | "content";

export const BOX_OWNED_STYLE_PROPERTIES = new Set([
  "aspect-ratio",
  "backdrop-filter",
  "block-size",
  "box-shadow",
  "clear",
  "clip",
  "clip-path",
  "content",
  "display",
  "filter",
  "float",
  "height",
  "inset",
  "isolation",
  "left",
  "mask",
  "mask-image",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "object-position",
  "opacity",
  "order",
  "overflow",
  "overflow-x",
  "overflow-y",
  "perspective",
  "position",
  "right",
  "top",
  "transform",
  "transform-origin",
  "visibility",
  "width",
  "z-index",
]);

export const BOX_OWNED_STYLE_PREFIXES = [
  "align-",
  "background",
  "border",
  "bottom",
  "column-",
  "contain",
  "flex",
  "gap",
  "grid",
  "inline-size",
  "justify-",
  "margin",
  "mask-",
  "max-inline-size",
  "max-block-size",
  "min-inline-size",
  "min-block-size",
  "outline",
  "padding",
  "place-",
  "rotate",
  "scale",
  "translate",
];

export function stylePropertyOwnsElementBox(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("--") || normalized.startsWith("@")) return true;
  return BOX_OWNED_STYLE_PROPERTIES.has(normalized)
    || BOX_OWNED_STYLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function styleScopeForProperties(properties: string[]): ReviewStyleScope {
  return properties.some(stylePropertyOwnsElementBox) ? "box" : "content";
}

export function changedVisualProperties(before: Element, after: Element): string[] {
  const properties = new Set<string>();
  VISUAL_ATTRIBUTE_NAMES.forEach((attributeName) => {
    const beforeValue = before.getAttribute(attributeName);
    const afterValue = after.getAttribute(attributeName);
    if (beforeValue === afterValue) return;
    if (attributeName === "style") {
      const beforeStyle = styleDeclarationMap(beforeValue || "");
      const afterStyle = styleDeclarationMap(afterValue || "");
      [...new Set([...beforeStyle.keys(), ...afterStyle.keys()])].forEach((property) => {
        if (beforeStyle.get(property) !== afterStyle.get(property)) properties.add(property);
      });
      return;
    }
    properties.add(`@${attributeName}`);
  });
  return [...properties];
}

export function elementsMatchingSelector(root: Element, rawSelector: string): Element[] {
  const selector = rawSelector
    .replace(/::[\w-]+/gu, "")
    .replace(/:(?:active|checked|disabled|enabled|focus|focus-visible|focus-within|hover|link|target|visited)(?:\([^)]*\))?/gu, "")
    .trim();
  if (!selector) return [];
  if (/^(?:\*|:root|html|body)$/iu.test(selector)) return [root];
  try {
    return [
      ...(root.matches(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];
  } catch {
    return [];
  }
}

export function semanticStylePairs(graph: ReviewSemanticPairGraph): Array<{
  before: Element;
  after: Element;
  semanticOwnerId: string;
  geometryOwnerId: string;
}> {
  const assignments = new Map<Element, {
    after: Element;
    semanticOwnerId: string;
    geometryOwnerId: string;
  }>();
  flattenReviewSemanticPairs(graph.root).forEach((pair) => {
    if (!pair.before || !pair.after) return;
    const add = (before: Element, after: Element) => {
      if (!assignments.has(before)) {
        assignments.set(before, {
          after,
          semanticOwnerId: pair.semanticOwnerId,
          geometryOwnerId: pair.geometryOwnerId,
        });
      }
    };
    add(pair.before.element, pair.after.element);
    if (pair.before.inventory && pair.after.inventory) {
      const inlineElements = (unit: ReviewSemanticUnit) => [...new Set(
        unit.inventory?.nodes.flatMap(({ node }) => {
          const elements: Element[] = [];
          let candidate = node.parentElement;
          while (candidate && candidate !== unit.element) {
            elements.unshift(candidate);
            candidate = candidate.parentElement;
          }
          return elements;
        }) || [],
      )];
      alignElementSiblings(
        inlineElements(pair.before),
        inlineElements(pair.after),
        graph.signatures,
      ).forEach((afterElement, beforeElement) => add(beforeElement, afterElement));
    } else if (pair.children.length === 0) {
      pairedVisualElements(
        pair.before.element,
        pair.after.element,
        graph.signatures,
      ).forEach((visualPair) => {
        add(visualPair.before, visualPair.after);
      });
    }
  });
  return [...assignments].map(([before, value]) => ({
    before,
    after: value.after,
    semanticOwnerId: value.semanticOwnerId,
    geometryOwnerId: value.geometryOwnerId,
  }));
}

export function markStyleDifferences(
  graph: ReviewSemanticPairGraph,
  layoutPairs: ReviewSemanticPairNode[],
): boolean {
  const before = graph.root.before?.element || null;
  const after = graph.root.after?.element || null;
  if (!before || !after) return false;
  let marked = 0;
  let ownerSequence = before.ownerDocument.querySelectorAll(
    "[data-pageroot-review-style-owner]",
  ).length;
  const markPair = (
    beforeElement: Element,
    afterElement: Element,
    scope: ReviewStyleScope,
    semanticOwnerId: string,
    geometryOwnerId: string,
    summary = "视觉调整",
    factOwner?: string,
    operation?: ReviewTextChangeOperation,
  ) => {
    const existingOwner = beforeElement.getAttribute("data-pageroot-review-style-owner")
      || afterElement.getAttribute("data-pageroot-review-style-owner")
      || factOwner
      || `style-owner-${++ownerSequence}`;
    const owner = factOwner || existingOwner;
    const existingScope = beforeElement.getAttribute("data-pageroot-review-style-scope")
      || afterElement.getAttribute("data-pageroot-review-style-scope");
    const resolvedScope: ReviewStyleScope = existingScope === "box" || scope === "box"
      ? "box"
      : "content";
    beforeElement.setAttribute("data-pageroot-review-style", "before");
    afterElement.setAttribute("data-pageroot-review-style", "after");
    // Legacy single-value attributes remain only as compatibility metadata for
    // runtime candidate suppression. The serialized fact list below is the
    // projection authority and can retain multiple independent facts.
    beforeElement.setAttribute("data-pageroot-review-style-owner", existingOwner);
    afterElement.setAttribute("data-pageroot-review-style-owner", existingOwner);
    beforeElement.setAttribute("data-pageroot-review-style-scope", resolvedScope);
    afterElement.setAttribute("data-pageroot-review-style-scope", resolvedScope);
    beforeElement.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
    afterElement.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
    if (geometryOwnerId) {
      beforeElement.setAttribute("data-pageroot-review-geometry-owner", geometryOwnerId);
      afterElement.setAttribute("data-pageroot-review-geometry-owner", geometryOwnerId);
    }
    const existingSummary = beforeElement.getAttribute("data-pageroot-review-style-summary")
      || afterElement.getAttribute("data-pageroot-review-style-summary");
    if (!existingSummary || summary !== "换行调整") {
      beforeElement.setAttribute("data-pageroot-review-style-summary", summary);
      afterElement.setAttribute("data-pageroot-review-style-summary", summary);
    }
    [beforeElement, afterElement].forEach((element) => {
      appendProjectionFactToElement(element, {
        id: owner,
        type: "style",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        ownerKey: owner,
        scope,
        summary,
        ...(operation ? { operation } : {}),
      });
    });
    marked += 1;
  };
  const boundedPairs = semanticStylePairs(graph);
  for (const pair of boundedPairs) {
    if (selfPresentationSignature(pair.before) === selfPresentationSignature(pair.after)) continue;
    markPair(
      pair.before,
      pair.after,
      styleScopeForProperties(changedVisualProperties(pair.before, pair.after)),
      pair.semanticOwnerId,
      pair.geometryOwnerId,
    );
  }
  const changedRules = changedStylesheetSelectors(before.ownerDocument, after.ownerDocument);
  changedRules.forEach(({ selector, labels }) => {
    const scope = styleScopeForProperties(labels);
    selector.split(",").forEach((part) => {
      const beforeMatches = new Set(elementsMatchingSelector(before, part));
      const afterMatches = new Set(elementsMatchingSelector(after, part));
      boundedPairs
        .filter((pair) => beforeMatches.has(pair.before) && afterMatches.has(pair.after))
        .forEach((pair) => {
          markPair(pair.before, pair.after, scope, pair.semanticOwnerId, pair.geometryOwnerId);
        });
    });
  });
  layoutPairs.forEach((pair) => {
    if (!pair.before || !pair.after) return;
    const layoutOwner = `layout-owner-${++ownerSequence}`;
    pair.before.element.setAttribute("data-pageroot-review-layout", "before");
    pair.after.element.setAttribute("data-pageroot-review-layout", "after");
    pair.before.element.setAttribute("data-pageroot-review-operation", "layout");
    pair.after.element.setAttribute("data-pageroot-review-operation", "layout");
    markPair(
      pair.before.element,
      pair.after.element,
      "content",
      pair.semanticOwnerId,
      pair.geometryOwnerId,
      "换行调整",
      layoutOwner,
      "layout",
    );
  });
  return marked > 0;
}

export function semanticLayoutPairs(graph: ReviewSemanticPairGraph): ReviewSemanticPairNode[] {
  return flattenReviewSemanticPairs(graph.root).filter((pair) => {
    const beforeInventory = pair.before?.inventory;
    const afterInventory = pair.after?.inventory;
    if (!beforeInventory || !afterInventory || beforeInventory.text !== afterInventory.text) return false;
    const plan = readableReviewTextFootprintPlan(
      beforeInventory.text,
      afterInventory.text,
      {
        before: [],
        after: [],
        layout: !sameBreakLayout(beforeInventory, afterInventory),
      },
    );
    return plan.operation === "layout";
  });
}
