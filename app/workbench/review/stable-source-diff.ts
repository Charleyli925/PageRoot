import {
  analyzeReviewStableIdTopology,
} from "../../lib/review-stable-id-diff.js";
import {
  isValidPagerootElementId,
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
} from "../../lib/pageroot-element-identity.js";
import {
  appendProjectionFactToElement,
} from "./parse";
import {
  REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE,
} from "./constants";
export type StableSourceChangeKind =
  | "moved"
  | "reordered"
  | "attribute"
  | "style";

export type StableSourceDifferenceAnalysis = {
  hasPersistentContinuity: boolean;
  sourceKinds: Array<"css-source" | "script-source">;
  ambiguousPersistentIds: string[];
  movedPairs: Array<{
    id: string;
    before: Element;
    after: Element;
    outermost: boolean;
  }>;
  reorderedPairs: Array<{
    parentId: string;
    before: Element;
    after: Element;
  }>;
};

const COMMON_STABLE_SOURCE_ATTRIBUTE = "data-pageroot-review-stable-common";

const CHANGE_SUMMARIES: Record<StableSourceChangeKind, string> = {
  moved: "移动元素",
  reordered: "元素顺序调整",
  attribute: "属性调整",
  style: "样式调整",
};

function sourceId(element: Element | null): string | null {
  const id = element?.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)?.trim() || "";
  return isValidPagerootElementId(id) ? id : null;
}

function uniqueSourceElements(document: Document): Map<string, Element> {
  const elements = new Map<string, Element | null>();
  document.querySelectorAll(`[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}]`).forEach((element) => {
    const id = sourceId(element);
    if (!id) return;
    elements.set(id, elements.has(id) ? null : element);
  });
  return new Map([...elements].filter((entry): entry is [string, Element] => Boolean(entry[1])));
}

function topologyDescriptors(document: Document) {
  const elements = [...document.querySelectorAll(`[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}]`)]
    .flatMap((element) => {
      const id = sourceId(element);
      return id ? [{ id, element }] : [];
    });
  const siblingIndexes = new WeakMap<Element, Map<Element, number>>();
  return elements.map(({ id, element }) => {
    const parent = element.parentElement;
    let indexes = parent ? siblingIndexes.get(parent) : undefined;
    if (parent && !indexes) {
      indexes = new Map<Element, number>();
      let index = 0;
      [...parent.children].forEach((candidate) => {
        if (!sourceId(candidate)) return;
        indexes!.set(candidate, index);
        index += 1;
      });
      siblingIndexes.set(parent, indexes);
    }
    return {
      id,
      parentId: sourceId(parent),
      index: indexes?.get(element) ?? 0,
    };
  });
}

function comparableAttributes(element: Element, excluded: Set<string>) {
  return [...element.attributes]
    .filter((attribute) => {
      const name = attribute.name.toLowerCase();
      return !excluded.has(name)
        && !name.startsWith("data-pageroot-");
    })
    .map((attribute) => `${attribute.name.toLowerCase()}=${attribute.value}`)
    .sort()
    .join("\u001f");
}

function authorSourceInventory(
  document: Document,
  kind: "css-source" | "script-source",
): string {
  const selector = kind === "css-source"
    ? "style, link[rel~='stylesheet' i]"
    : "script";
  return [...document.querySelectorAll(selector)]
    .map((element) => [
      element.namespaceURI || "",
      element.localName,
      comparableAttributes(element, new Set()),
      element.textContent || "",
    ].join("\u0000"))
    .join("\u0001");
}

function normalizedCssDeclarations(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split(";")
    .map((declaration) => declaration.trim().replace(/\s*:\s*/u, ":"))
    .filter(Boolean)
    .join(";");
}

function simpleCssRuleMap(document: Document): Map<string, string> {
  const rules = new Map<string, string>();
  document.querySelectorAll("style").forEach((style) => {
    const source = (style.textContent || "").replace(/\/\*[\s\S]*?\*\//gu, "");
    const pattern = /([^{}]+)\{([^{}]*)\}/gu;
    let match = pattern.exec(source);
    while (match) {
      match[1].split(",").map((selector) => selector.trim()).filter((selector) => (
        selector
        && !selector.startsWith("@")
        && !/[\s>+~:]/u.test(selector)
        && /^(?:[a-z][\w-]*)?(?:#[\w-]+)?(?:\.[\w-]+)*(?:\[[\w-]+(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]\s]+))?\])*$/iu.test(selector)
      )).forEach((selector) => {
        const declarations = normalizedCssDeclarations(match![2]);
        const previous = rules.get(selector);
        rules.set(selector, previous ? `${previous}\u0001${declarations}` : declarations);
      });
      match = pattern.exec(source);
    }
  });
  return rules;
}

function changedSimpleCssSelectors(beforeDocument: Document, afterDocument: Document): string[] {
  const before = simpleCssRuleMap(beforeDocument);
  const after = simpleCssRuleMap(afterDocument);
  return [...new Set([...before.keys(), ...after.keys()])].filter((selector) => (
    before.get(selector) !== after.get(selector)
  ));
}

function annotateStructureFact(
  element: Element,
  id: string,
  kind: StableSourceChangeKind,
) {
  const semanticOwnerId = `stable-${id}`;
  const geometryOwnerId = `stable-geometry-${id}`;
  element.setAttribute("data-pageroot-review-structure", kind);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
  element.setAttribute("data-pageroot-review-geometry-owner", geometryOwnerId);
  appendProjectionFactToElement(element, {
    id: `stable-${kind}-${id}`,
    type: "structure",
    semanticOwnerId,
    geometryOwnerId,
    scope: "element",
    structureChange: kind,
    summary: CHANGE_SUMMARIES[kind],
  });
}

export function annotateStableSourceDifferences(
  beforeDocument: Document,
  afterDocument: Document,
): StableSourceDifferenceAnalysis {
  const beforeElements = uniqueSourceElements(beforeDocument);
  const afterElements = uniqueSourceElements(afterDocument);
  const topology = analyzeReviewStableIdTopology(
    topologyDescriptors(beforeDocument),
    topologyDescriptors(afterDocument),
  );
  const movedIds = new Set(topology.movedIds);
  const sourceKinds = new Set<"css-source" | "script-source">();

  // Page-level source inventories only coexist with proven persistent
  // continuity. Elements that claim a persistent identity but do not share it
  // are still emitted as additions/removals by semantic pairing; they never
  // regain identity through the legacy matcher.
  if (topology.commonIds.length) {
    (["css-source", "script-source"] as const).forEach((kind) => {
      if (authorSourceInventory(beforeDocument, kind)
        !== authorSourceInventory(afterDocument, kind)) sourceKinds.add(kind);
    });
  }

  topology.commonIds.forEach((id) => {
    const before = beforeElements.get(id)!;
    const after = afterElements.get(id)!;
    before.setAttribute(COMMON_STABLE_SOURCE_ATTRIBUTE, "true");
    after.setAttribute(COMMON_STABLE_SOURCE_ATTRIBUTE, "true");

    if (movedIds.has(id)) {
      annotateStructureFact(before, id, "moved");
      annotateStructureFact(after, id, "moved");
    }

    const isScript = before.tagName === "SCRIPT" || after.tagName === "SCRIPT";
    const isCssSource = before.tagName === "STYLE"
      || after.tagName === "STYLE"
      || before.matches("link[rel~='stylesheet' i]")
      || after.matches("link[rel~='stylesheet' i]");
    if (isScript || isCssSource) return;

    if ((before.getAttribute("style") || "") !== (after.getAttribute("style") || "")) {
      annotateStructureFact(before, id, "style");
      annotateStructureFact(after, id, "style");
    }
    if (
      before.namespaceURI !== after.namespaceURI
      || before.localName !== after.localName
      || comparableAttributes(before, new Set(["style"]))
        !== comparableAttributes(after, new Set(["style"]))
    ) {
      annotateStructureFact(before, id, "attribute");
      annotateStructureFact(after, id, "attribute");
      if (
        (before.namespaceURI !== after.namespaceURI || before.localName !== after.localName)
        && before.textContent === after.textContent
      ) {
        before.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
        after.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
      }
    }
  });

  changedSimpleCssSelectors(beforeDocument, afterDocument).forEach((selector) => {
    ([beforeDocument, afterDocument] as const).forEach((document) => {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          const id = sourceId(element);
          if (id && topology.commonIds.includes(id)) annotateStructureFact(element, id, "style");
        });
      } catch {
        // Selector parsing is deliberately best-effort. Complex or invalid
        // selectors stay in diagnostics and never become a page-level marker.
      }
    });
  });

  const elementDepth = (element: Element) => {
    let value = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) value += 1;
    return value;
  };
  const movedPairs = topology.movedIds.map((id) => {
    const before = beforeElements.get(id)!;
    const after = afterElements.get(id)!;
    const hasMovedAncestor = (element: Element) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        const ancestorId = sourceId(ancestor);
        if (ancestorId && movedIds.has(ancestorId)) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    return {
      id,
      before,
      after,
      outermost: !hasMovedAncestor(before) && !hasMovedAncestor(after),
    };
  }).sort((left, right) => elementDepth(right.before) - elementDepth(left.before));
  const reorderedPairs = topology.reorderedRanges.flatMap((range) => {
    if (!range.parentId) return [];
    const before = beforeElements.get(range.parentId);
    const after = afterElements.get(range.parentId);
    if (!before || !after) return [];
    annotateStructureFact(before, range.parentId, "reordered");
    annotateStructureFact(after, range.parentId, "reordered");
    return [{ parentId: range.parentId, before, after }];
  });

  return {
    hasPersistentContinuity: topology.commonIds.length > 0,
    sourceKinds: [...sourceKinds],
    ambiguousPersistentIds: topology.duplicateIds,
    movedPairs,
    reorderedPairs,
  };
}
