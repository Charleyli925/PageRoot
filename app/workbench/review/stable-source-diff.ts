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

function normalizedCssWhitespace(value: string): string {
  let result = "";
  let quote = "";
  let escaped = false;
  let pendingWhitespace = false;
  for (const character of value) {
    if (quote) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      if (pendingWhitespace && result) result += " ";
      pendingWhitespace = false;
      quote = character;
      result += character;
      continue;
    }
    if (/\s/u.test(character)) {
      pendingWhitespace = true;
      continue;
    }
    if (pendingWhitespace && result) result += " ";
    pendingWhitespace = false;
    result += character;
  }
  return result.trim();
}

function normalizedCssDeclarations(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split(";")
    .map((declaration) => normalizedCssWhitespace(declaration).replace(/\s*:\s*/u, ":"))
    .filter(Boolean)
    .join(";");
}

function simpleCssRuleMap(document: Document): Map<string, {
  selectors: string[];
  declarations: string;
}> {
  const rules = new Map<string, { selectors: string[]; declarations: string }>();
  document.querySelectorAll("style").forEach((style) => {
    const source = (style.textContent || "").replace(/\/\*[\s\S]*?\*\//gu, "");
    const pattern = /([^{}]+)\{([^{}]*)\}/gu;
    let match = pattern.exec(source);
    while (match) {
      const selectors = match[1].split(",").map((selector) => selector.trim()).filter((selector) => (
        selector
        && !selector.startsWith("@")
        && !/[\s>+~:]/u.test(selector)
        && /^(?:[a-z][\w-]*)?(?:#[\w-]+)?(?:\.[\w-]+)*(?:\[[\w-]+(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]\s]+))?\])*$/iu.test(selector)
      )).sort();
      if (selectors.length) {
        const declarations = normalizedCssDeclarations(match![2]);
        const key = selectors.join("\u001f");
        const previous = rules.get(key);
        rules.set(key, {
          selectors,
          declarations: previous
            ? `${previous.declarations}\u0001${declarations}`
            : declarations,
        });
      }
      match = pattern.exec(source);
    }
  });
  return rules;
}

function changedSimpleCssSelectors(beforeDocument: Document, afterDocument: Document): Array<{
  selectors: string[];
  ruleKey: string;
  before: string;
  after: string;
}> {
  const before = simpleCssRuleMap(beforeDocument);
  const after = simpleCssRuleMap(afterDocument);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((ruleKey) => {
    const beforeRule = before.get(ruleKey);
    const afterRule = after.get(ruleKey);
    const beforeDeclarations = beforeRule?.declarations || "";
    const afterDeclarations = afterRule?.declarations || "";
    return beforeDeclarations === afterDeclarations
      ? []
      : [{
        selectors: beforeRule?.selectors || afterRule?.selectors || [],
        ruleKey,
        before: beforeDeclarations,
        after: afterDeclarations,
      }];
  });
}

function deterministicReviewHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function displayScopeForElement(element: Element) {
  if (element.matches("li")) return "list-item" as const;
  if (element.matches("td, th")) return "cell" as const;
  if (element.matches("button, input, select, textarea, a[href], [role='button']")) {
    return "component" as const;
  }
  if (element.matches("p, h1, h2, h3, h4, h5, h6, blockquote, pre")) {
    return "paragraph" as const;
  }
  return "container" as const;
}

function geometryModeForElement(element: Element) {
  // Structure and style facts always measure the complete affected element.
  // A shared style region may promote several such owners to container-box at
  // the Focus Group planning boundary, never at exact-fact creation time.
  void element;
  return "element-box" as const;
}

function localElementIdentity(element: Element | null): string {
  if (!element) return "root";
  const persistentId = sourceId(element);
  if (persistentId) return `stable-${persistentId}`;
  const path: string[] = [];
  let candidate: Element | null = element;
  while (candidate && candidate !== candidate.ownerDocument.documentElement) {
    const parent: Element | null = candidate.parentElement;
    if (!parent) break;
    path.unshift(`${candidate.localName}-${[...parent.children].indexOf(candidate)}`);
    const anchorId = sourceId(parent);
    if (anchorId) {
      path.unshift(`stable-${anchorId}`);
      break;
    }
    candidate = parent;
    if (path.length >= 12) break;
  }
  return path.join("_") || element.localName;
}

function nearestSemanticContainerIdentity(element: Element): string {
  const container = element.closest(
    "li, td, th, article, section, aside, nav, header, footer, form, fieldset, ul, ol, table, [role='list'], [role='group']",
  );
  return localElementIdentity(container || element.parentElement);
}

function inlineStyleDeltaKey(before: Element, after: Element): string {
  const properties = new Set<string>();
  for (const style of [before.getAttribute("style") || "", after.getAttribute("style") || ""]) {
    style.split(";").forEach((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator > 0) properties.add(declaration.slice(0, separator).trim().toLowerCase());
    });
  }
  return [...properties].sort().flatMap((property) => {
    const beforeValue = (before as HTMLElement).style.getPropertyValue(property).trim();
    const afterValue = (after as HTMLElement).style.getPropertyValue(property).trim();
    return beforeValue === afterValue ? [] : [`${property}:${beforeValue}\u0000${afterValue}`];
  }).join("\u0001");
}

function annotateStructureFact(
  element: Element,
  id: string,
  kind: StableSourceChangeKind,
  displayGroupId = `display-stable-${kind}-${id}`,
  factId = `stable-${kind}-${id}`,
) {
  const semanticOwnerId = `stable-${id}`;
  const geometryOwnerId = `stable-geometry-${id}`;
  element.setAttribute("data-pageroot-review-structure", kind);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
  element.setAttribute("data-pageroot-review-geometry-owner", geometryOwnerId);
  const displayOwnerId = `display-owner-stable-${id}`;
  const displayOwners = new Set(
    (element.getAttribute("data-pageroot-review-display-owner") || "").split(/\s+/u).filter(Boolean),
  );
  displayOwners.add(displayOwnerId);
  element.setAttribute("data-pageroot-review-display-owner", [...displayOwners].join(" "));
  element.setAttribute("data-pageroot-review-geometry-mode", geometryModeForElement(element));
  appendProjectionFactToElement(element, {
    id: factId,
    type: "structure",
    semanticOwnerId,
    geometryOwnerId,
    scope: "element",
    displayGroupId,
    displayOwnerId,
    displayScope: displayScopeForElement(element),
    geometryMode: geometryModeForElement(element),
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
      const deltaKey = inlineStyleDeltaKey(before, after);
      const beforeLocality = `${nearestSemanticContainerIdentity(before)}\u0000${localElementIdentity(before.parentElement)}`;
      const afterLocality = `${nearestSemanticContainerIdentity(after)}\u0000${localElementIdentity(after.parentElement)}`;
      // Identity continuity is already proven for the element. Locality is
      // deliberately side-independent only when the semantic container and
      // stable parent identities agree; moved targets cannot merge sections.
      const locality = beforeLocality === afterLocality ? beforeLocality : `moved-${id}`;
      // An inline style attribute is an operation on one persistent element,
      // not a shared source rule. Keep the locality in the identity to prevent
      // cross-module collisions, and keep the target id so sibling elements
      // with identical deltas never become one synthetic operation.
      const groupId = `display-inline-${deterministicReviewHash(`${deltaKey || id}\u0000${locality}\u0000${id}`)}`;
      annotateStructureFact(before, id, "style", groupId);
      annotateStructureFact(after, id, "style", groupId);
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

  changedSimpleCssSelectors(beforeDocument, afterDocument).forEach((rule) => {
    const selectorHash = deterministicReviewHash(
      `${rule.ruleKey}\u0000${rule.before}\u0000${rule.after}`,
    );
    const displayGroupId = `display-css-${selectorHash}`;
    ([beforeDocument, afterDocument] as const).forEach((document) => {
      rule.selectors.forEach((selector) => {
        let matches: Element[];
        try {
          matches = [...document.querySelectorAll(selector)];
        } catch {
          // Selector parsing is deliberately best-effort. Complex or invalid
          // selectors stay in diagnostics and never become a page-level marker.
          return;
        }
        matches.forEach((element) => {
          const id = sourceId(element);
          if (id && topology.commonIds.includes(id)) {
            annotateStructureFact(
              element,
              id,
              "style",
              displayGroupId,
              `stable-style-css-${selectorHash}-${id}`,
            );
          }
        });
      });
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
