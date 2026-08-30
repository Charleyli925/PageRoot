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
  | "attribute"
  | "style"
  | "css-source"
  | "script-source";

export type StableSourceDifferenceAnalysis = {
  hasPersistentContinuity: boolean;
  sourceKinds: Array<"css-source" | "script-source">;
  ambiguousPersistentIds: string[];
};

const COMMON_STABLE_SOURCE_ATTRIBUTE = "data-pageroot-review-stable-common";

const CHANGE_SUMMARIES: Record<StableSourceChangeKind, string> = {
  moved: "移动元素",
  attribute: "属性调整",
  style: "样式调整",
  "css-source": "CSS 源码调整",
  "script-source": "Script 源码调整",
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
  return [...document.querySelectorAll(`[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}]`)]
    .flatMap((element) => {
      const id = sourceId(element);
      return id ? [{
        id,
        parentId: sourceId(element.parentElement),
        index: [...(element.parentElement?.children || [])]
          .filter((candidate) => Boolean(sourceId(candidate)))
          .indexOf(element),
      }] : [];
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

function visibleSourceText(element: Element): string {
  let text = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches("script, style, noscript, template")) return;
    if (node.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
    node.childNodes.forEach(visit);
  };
  element.childNodes.forEach(visit);
  return text.replace(/\s+/gu, " ").trim();
}

function authorSourceKind(
  element: Element,
): "css-source" | "script-source" | null {
  if (element.tagName === "SCRIPT") return "script-source";
  return element.tagName === "STYLE" || element.matches("link[rel~='stylesheet' i]")
    ? "css-source"
    : null;
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

function annotateMovedTextPair(before: Element, after: Element, id: string) {
  before.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
  after.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
  if (visibleSourceText(before) === visibleSourceText(after)) return;
  const semanticOwnerId = `stable-${id}`;
  const geometryOwnerId = `stable-geometry-${id}`;
  [
    { element: before, tone: "removed" as const },
    { element: after, tone: "added" as const },
  ].forEach(({ element, tone }) => {
    element.setAttribute("data-pageroot-review-text", tone);
    element.setAttribute("data-pageroot-review-text-operation", "replace");
    element.setAttribute("data-pageroot-review-text-group", `moved-text-${id}`);
    appendProjectionFactToElement(element, {
      id: `moved-text-${id}`,
      type: "text",
      semanticOwnerId,
      geometryOwnerId,
      scope: "text-block",
      operation: "replace",
      tone,
      textGroup: `moved-text-${id}`,
      summary: "文本调整",
    });
  });
}

export function annotateStablePageSourceAggregate(
  document: Document,
  kinds: ReadonlySet<"css-source" | "script-source">,
) {
  const root = document.documentElement;
  kinds.forEach((kind) => {
    const id = kind === "css-source" ? "page-css-source" : "page-script-source";
    annotateStructureFact(root, id, kind);
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

  // A Candidate that churned every ID has no persistent-identity continuity;
  // keep that historical input on the legacy matcher instead of describing
  // every <style>/<script> as a source addition/removal. One surviving stable
  // source identity is the minimum evidence that this topology is meaningful.
  if (topology.commonIds.length) {
    for (const [ids, elements] of [
      [topology.addedIds, afterElements],
      [topology.removedIds, beforeElements],
    ] as const) {
      ids.forEach((id) => {
        const element = elements.get(id);
        const kind = element ? authorSourceKind(element) : null;
        if (!element || !kind) return;
        sourceKinds.add(kind);
      });
    }
  }

  topology.commonIds.forEach((id) => {
    const before = beforeElements.get(id)!;
    const after = afterElements.get(id)!;
    before.setAttribute(COMMON_STABLE_SOURCE_ATTRIBUTE, "true");
    after.setAttribute(COMMON_STABLE_SOURCE_ATTRIBUTE, "true");

    if (movedIds.has(id)) {
      annotateStructureFact(before, id, "moved");
      annotateStructureFact(after, id, "moved");
      annotateMovedTextPair(before, after, id);
    }

    const isScript = before.tagName === "SCRIPT" || after.tagName === "SCRIPT";
    const isCssSource = before.tagName === "STYLE"
      || after.tagName === "STYLE"
      || before.matches("link[rel~='stylesheet' i]")
      || after.matches("link[rel~='stylesheet' i]");
    if (isScript && (
      before.textContent !== after.textContent
      || comparableAttributes(before, new Set(["style"]))
        !== comparableAttributes(after, new Set(["style"]))
    )) {
      sourceKinds.add("script-source");
      return;
    }
    if (isCssSource && (
      before.textContent !== after.textContent
      || comparableAttributes(before, new Set(["style"]))
        !== comparableAttributes(after, new Set(["style"]))
    )) {
      sourceKinds.add("css-source");
      return;
    }

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
    }
  });

  return {
    hasPersistentContinuity: topology.commonIds.length > 0,
    sourceKinds: [...sourceKinds],
    ambiguousPersistentIds: topology.duplicateIds,
  };
}
