import { alignReviewSemanticUnits } from "../../lib/review-semantic-alignment.js";
import type {
  ReviewSemanticAlignmentMatch,
} from "../../lib/review-semantic-alignment.js";
import {
  NON_CONTENT_TAGS,
} from "./constants";
import {
  classTokens,
  createReviewSignatureCache,
  directHeading,
  exactSubtreeSignature,
  GENERIC_REVIEW_TEXT_CLASSES,
  hasAmbiguousPersistentIdentity,
  hasClassRole,
  isReviewTextBlockElement,
  normalizedText,
  NUMBERED_TEXT_LINE_PATTERN,
  panelPathForElement,
  reviewTextInventory,
  reviewTextInventoryForNodes,
  selfCompatibilitySignature,
  sliceReviewTextInventory,
  stableElementIdentity,
} from "./parse";
import type {
  ReviewSemanticPairGraph,
  ReviewSemanticPairNode,
  ReviewSemanticUnit,
  ReviewSignatureCache,
  SectionPair,
  TextRange,
} from "./types";

export const REVIEW_LEAF_TEXT_OWNER_TAGS = new Set([
  "ADDRESS",
  "BLOCKQUOTE",
  "BUTTON",
  "CAPTION",
  "DD",
  "DT",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "PRE",
  "SUMMARY",
]);

// These elements contribute visible content without contributing to the text
// inventory. They must not be left inside a direct-flow unit: that unit is
// intentionally discarded when it contains neither text nor authored <br>s.
// Foreign-namespace content (notably SVG and MathML) follows the same rule.
export const REVIEW_ATOMIC_CONTENT_TAGS = new Set([
  "AREA",
  "AUDIO",
  "CANVAS",
  "EMBED",
  "HR",
  "IFRAME",
  "IMG",
  "INPUT",
  "METER",
  "OBJECT",
  "PICTURE",
  "PROGRESS",
  "SELECT",
  "TEXTAREA",
  "VIDEO",
]);

export function isReviewAtomicContentElement(element: Element): boolean {
  return element.namespaceURI !== "http://www.w3.org/1999/xhtml"
    || REVIEW_ATOMIC_CONTENT_TAGS.has(element.tagName);
}

export function atomicContentSemanticUnit(element: Element): ReviewSemanticUnit {
  return {
    kind: "atomic-content",
    element,
    inventory: null,
    children: [],
  };
}

export function semanticFlowUnit(
  owner: Element,
  sourceNodes: Node[],
): ReviewSemanticUnit | null {
  const inventory = reviewTextInventoryForNodes(sourceNodes);
  if (!inventory.text.trim() && !inventory.breakOffsets.length) return null;
  const breakOffsets = [...new Set(inventory.breakOffsets)]
    .filter((offset) => offset >= 0 && offset <= inventory.text.length)
    .sort((left, right) => left - right);
  const lineRanges: TextRange[] = [];
  let start = 0;
  [...breakOffsets, inventory.text.length].forEach((end) => {
    lineRanges.push({ start, end });
    start = end;
  });
  const nonEmptyLines = lineRanges.filter((range) => (
    inventory.text.slice(range.start, range.end).trim()
  ));
  const numberedLines = nonEmptyLines.length >= 2 && nonEmptyLines.every((range) => (
    NUMBERED_TEXT_LINE_PATTERN.test(inventory.text.slice(range.start, range.end))
  ));
  if (!numberedLines) {
    return {
      kind: "direct-flow",
      element: owner,
      inventory,
      children: [],
    };
  }
  return {
    kind: "direct-flow",
    element: owner,
    inventory: null,
    children: lineRanges.map((range) => ({
      kind: "br-line" as const,
      element: owner,
      inventory: sliceReviewTextInventory(inventory, range.start, range.end),
      children: [],
    })),
  };
}

export function semanticChildrenForContainer(container: Element): ReviewSemanticUnit[] {
  const children: ReviewSemanticUnit[] = [];
  let flow: Node[] = [];
  const flush = () => {
    if (!flow.length) return;
    const unit = semanticFlowUnit(container, flow);
    if (unit) children.push(unit);
    flow = [];
  };
  container.childNodes.forEach((node) => {
    if (node instanceof Element && NON_CONTENT_TAGS.has(node.tagName)) return;
    if (node instanceof Element && isReviewAtomicContentElement(node)) {
      flush();
      children.push(atomicContentSemanticUnit(node));
      return;
    }
    if (
      node instanceof Element
      && node.namespaceURI === "http://www.w3.org/1999/xhtml"
      && isReviewTextBlockElement(node)
    ) {
      flush();
      children.push(buildReviewSemanticUnit(node));
      return;
    }
    flow.push(node);
  });
  flush();
  return children;
}

export function tableCellUnits(row: Element): ReviewSemanticUnit[] {
  let logicalColumn = 0;
  return [...row.children]
    .filter((element) => element.matches("th, td"))
    .map((element) => {
      const rawSpan = Number.parseInt(element.getAttribute("colspan") || "1", 10);
      const columnSpan = Number.isFinite(rawSpan) && rawSpan > 0 ? rawSpan : 1;
      const unit = buildReviewSemanticUnit(element);
      unit.columnStart = logicalColumn;
      unit.columnSpan = columnSpan;
      logicalColumn += columnSpan;
      return unit;
    });
}

export function buildReviewSemanticUnit(element: Element): ReviewSemanticUnit {
  if (isReviewAtomicContentElement(element)) return atomicContentSemanticUnit(element);
  if (element.matches("ul, ol")) {
    return {
      kind: "list",
      element,
      inventory: null,
      children: [...element.children]
        .filter((child) => child.tagName === "LI")
        .map(buildReviewSemanticUnit),
    };
  }
  if (element.tagName === "LI") {
    return {
      kind: "list-item",
      element,
      inventory: null,
      children: semanticChildrenForContainer(element),
    };
  }
  if (element.tagName === "TABLE") {
    return {
      kind: "table",
      element,
      inventory: null,
      children: [...element.children]
        .filter((child) => child.matches("caption, thead, tbody, tfoot, tr"))
        .map(buildReviewSemanticUnit),
    };
  }
  if (element.matches("thead, tbody, tfoot")) {
    return {
      kind: "row-group",
      element,
      inventory: null,
      children: [...element.children]
        .filter((child) => child.tagName === "TR")
        .map(buildReviewSemanticUnit),
    };
  }
  if (element.tagName === "TR") {
    return {
      kind: "table-row",
      element,
      inventory: null,
      children: tableCellUnits(element),
    };
  }
  if (element.matches("td, th")) {
    return {
      kind: "table-cell",
      element,
      inventory: null,
      children: semanticChildrenForContainer(element),
    };
  }
  const hasBlockChild = [...element.children].some((child) => (
    isReviewTextBlockElement(child)
  ));
  if (REVIEW_LEAF_TEXT_OWNER_TAGS.has(element.tagName) && !hasBlockChild) {
    return {
      kind: "leaf-text-block",
      element,
      inventory: reviewTextInventory(element),
      children: [],
    };
  }
  return {
    kind: element.matches("section, article, main, header, footer, nav")
      ? "section"
      : "container",
    element,
    inventory: null,
    children: semanticChildrenForContainer(element),
  };
}

export function semanticUnitText(unit: ReviewSemanticUnit): string {
  if (unit.inventory) return unit.inventory.text;
  if (unit.kind === "table-row") {
    return [...unit.element.children]
      .filter((element) => element.matches("th, td"))
      .map((element) => normalizedText(element))
      .join("\u001f");
  }
  return normalizedText(unit.element);
}

const REVIEW_RELOCATABLE_CARD_ROLES = ["card", "tile", "metric", "kpi", "stat"];

function relocationLabel(element: Element): string {
  const heading = directHeading(element);
  if (heading) return normalizedText(heading);
  const label = [...element.querySelectorAll(":scope > [class], :scope > header [class]")]
    .find((candidate) => (
      hasClassRole(candidate, ["label", "name", "title", "heading"])
      && !hasClassRole(candidate, ["note", "meta", "sub", "subtitle"])
      && normalizedText(candidate).length > 0
    ));
  return label ? normalizedText(label) : "";
}

function semanticRelocationKey(
  element: Element,
  unitKind: string,
  signatures: ReviewSignatureCache,
): string | null {
  const relocatable = element.matches("section, article")
    || hasClassRole(element, REVIEW_RELOCATABLE_CARD_ROLES);
  if (!relocatable) return null;
  const label = relocationLabel(element);
  if (!label) return null;
  const panelScope = panelPathForElement(element).join("\u0001") || "document";
  return [
    "card-relocation",
    panelScope,
    unitKind,
    element.namespaceURI || "",
    element.localName.toLowerCase(),
    selfCompatibilitySignature(element, signatures),
    label,
  ].join("\u0000");
}

export function semanticUnitDescriptor(
  unit: ReviewSemanticUnit,
  parentKey: string,
  signatures: ReviewSignatureCache,
  usePersistentIdentity = true,
  ambiguousPersistentIds: ReadonlySet<string> = new Set(),
) {
  const logicalCell = unit.kind === "table-cell"
    ? `:${unit.element.tagName}:${unit.columnStart ?? -1}:${unit.columnSpan ?? 1}`
    : `:${unit.element.tagName}`;
  const text = semanticUnitText(unit);
  const numberedPrefix = unit.kind === "br-line"
    ? text.match(NUMBERED_TEXT_LINE_PATTERN)?.[0]?.trim() || ""
    : "";
  const ownsElementIdentity = unit.kind !== "direct-flow" && unit.kind !== "br-line";
  const textExactSignature = text
    ? `${unit.kind}\u0000${logicalCell}\u0000${text}`
    : null;
  const exactSignature = unit.kind === "direct-flow" || unit.kind === "br-line"
    ? textExactSignature
    : `${unit.kind}\u0000${logicalCell}\u0000${exactSubtreeSignature(unit.element, signatures)}`;
  return {
    kind: `${unit.kind}${logicalCell}`,
    text,
    stableId: ownsElementIdentity
      ? stableElementIdentity(
        unit.element,
        signatures,
        usePersistentIdentity,
        ambiguousPersistentIds,
      )
      : null,
    identityAmbiguous: ownsElementIdentity
      && hasAmbiguousPersistentIdentity(unit.element, ambiguousPersistentIds),
    exactSignature,
    compatibilitySignature: `${unit.kind}\u0000${logicalCell}\u0000${selfCompatibilitySignature(
      unit.element,
      signatures,
    )}`,
    relocationKey: semanticRelocationKey(unit.element, unit.kind, signatures),
    affinities: [
      ...classTokens(unit.element).filter((token) => !GENERIC_REVIEW_TEXT_CLASSES.has(token)),
      ...(numberedPrefix ? [`number:${numberedPrefix}`] : []),
    ],
    parentKey,
  };
}

export function sameLogicalCellPattern(
  before: ReviewSemanticUnit[],
  after: ReviewSemanticUnit[],
): boolean {
  return before.length === after.length && before.every((unit, index) => {
    const candidate = after[index];
    return candidate
      && unit.element.tagName === candidate.element.tagName
      && unit.columnStart === candidate.columnStart
      && unit.columnSpan === candidate.columnSpan;
  });
}

export function* buildReviewSemanticPairGraphSteps(
  pair: SectionPair,
  options: {
    usePersistentIdentity?: boolean;
    ambiguousPersistentIds?: ReadonlySet<string>;
  } = {},
): Generator<"semantic-row", ReviewSemanticPairGraph, void> {
  const signatures = createReviewSignatureCache();
  let semanticOwnerSequence = 0;
  let geometryOwnerSequence = 0;
  let parentSequence = 0;
  let semanticRowsSinceYield = 0;
  const geometryOwners = new WeakMap<Element, string>();
  const semanticOwner = () => `semantic-owner-${++semanticOwnerSequence}`;
  const geometryOwner = (before: Element | null, after: Element | null) => {
    const existing = (before && geometryOwners.get(before))
      || (after && geometryOwners.get(after));
    const ownerId = existing || `geometry-owner-${++geometryOwnerSequence}`;
    [before, after].forEach((element) => {
      if (!element) return;
      geometryOwners.set(element, ownerId);
      element.setAttribute("data-pageroot-review-geometry-owner", ownerId);
    });
    return ownerId;
  };
  const createPair = function* (
    before: ReviewSemanticUnit | null,
    after: ReviewSemanticUnit | null,
    match: ReviewSemanticAlignmentMatch,
    inheritedOwnerId?: string,
  ): Generator<"semantic-row", ReviewSemanticPairNode, void> {
    const ownerId = inheritedOwnerId || semanticOwner();
    const node: ReviewSemanticPairNode = {
      before,
      after,
      match,
      semanticOwnerId: ownerId,
      geometryOwnerId: geometryOwner(before?.element || null, after?.element || null),
      structureFallback: false,
      children: [],
    };
    if (!before || !after) {
      const children = before?.children || after?.children || [];
      for (const child of children) {
        node.children.push(yield* createPair(
          before ? child : null,
          after ? child : null,
          "unmatched",
          ownerId,
        ));
      }
      if (node.before?.kind === "table-row" || node.before?.kind === "list-item"
        || node.before?.kind === "br-line" || node.after?.kind === "table-row"
        || node.after?.kind === "list-item" || node.after?.kind === "br-line") {
        semanticRowsSinceYield += 1;
        if (semanticRowsSinceYield >= 24) {
          semanticRowsSinceYield = 0;
          yield "semantic-row";
        }
      }
      return node;
    }
    if (
      before.kind === "table-row"
      && after.kind === "table-row"
      && !sameLogicalCellPattern(before.children, after.children)
    ) {
      node.structureFallback = true;
      for (const child of before.children) {
        node.children.push(yield* createPair(child, null, "unmatched", ownerId));
      }
      for (const child of after.children) {
        node.children.push(yield* createPair(null, child, "unmatched", ownerId));
      }
      semanticRowsSinceYield += 1;
      if (semanticRowsSinceYield >= 24) {
        semanticRowsSinceYield = 0;
        yield "semantic-row";
      }
      return node;
    }
    const parentKey = `semantic-parent-${++parentSequence}`;
    const aligned = alignReviewSemanticUnits(
      before.children.map((unit) => semanticUnitDescriptor(
        unit,
        parentKey,
        signatures,
        options.usePersistentIdentity !== false,
        options.ambiguousPersistentIds,
      )),
      after.children.map((unit) => semanticUnitDescriptor(
        unit,
        parentKey,
        signatures,
        options.usePersistentIdentity !== false,
        options.ambiguousPersistentIds,
      )),
    );
    for (const childPair of aligned) {
      node.children.push(yield* createPair(
        childPair.beforeIndex === null ? null : before.children[childPair.beforeIndex],
        childPair.afterIndex === null ? null : after.children[childPair.afterIndex],
        childPair.match,
      ));
    }
    if (node.before?.kind === "table-row" || node.before?.kind === "list-item"
      || node.before?.kind === "br-line" || node.after?.kind === "table-row"
      || node.after?.kind === "list-item" || node.after?.kind === "br-line") {
      semanticRowsSinceYield += 1;
      if (semanticRowsSinceYield >= 24) {
        semanticRowsSinceYield = 0;
        yield "semantic-row";
      }
    }
    return node;
  };
  const beforeRoot = pair.before ? buildReviewSemanticUnit(pair.before) : null;
  const afterRoot = pair.after ? buildReviewSemanticUnit(pair.after) : null;
  return {
    root: yield* createPair(
      beforeRoot,
      afterRoot,
      beforeRoot && afterRoot ? "weighted" : "unmatched",
    ),
    signatures,
  };
}

export function flattenReviewSemanticPairs(root: ReviewSemanticPairNode): ReviewSemanticPairNode[] {
  return [root, ...root.children.flatMap(flattenReviewSemanticPairs)];
}

export function sectionElementDescriptor(
  element: Element,
  parentKey: string,
  signatures: ReviewSignatureCache,
  usePersistentIdentity = true,
  ambiguousPersistentIds: ReadonlySet<string> = new Set(),
) {
  return {
    kind: `${element.namespaceURI || ""}:${element.localName.toLowerCase()}`,
    text: normalizedText(element),
    stableId: stableElementIdentity(
      element,
      signatures,
      usePersistentIdentity,
      ambiguousPersistentIds,
    ),
    identityAmbiguous: hasAmbiguousPersistentIdentity(element, ambiguousPersistentIds),
    exactSignature: exactSubtreeSignature(element, signatures),
    compatibilitySignature: selfCompatibilitySignature(element, signatures),
    relocationKey: semanticRelocationKey(element, "section", signatures),
    parentKey,
  };
}

export function semanticElementName(element: Element): string {
  if (hasClassRole(element, ["card", "tile"])) return "卡片";
  if (element.matches("figure, svg, canvas")) return "图表";
  if (element.matches("img, picture")) return "图片";
  if (element.matches("li")) return "列表项";
  if (element.matches("table")) return "表格";
  if (element.matches("section, article")) return "区块";
  if (element.matches("h1, h2, h3, h4, h5, h6, p")) return "文本段";
  return "元素";
}

export function pairSections(
  before: Element[],
  after: Element[],
  options: {
    usePersistentIdentity?: boolean;
    ambiguousPersistentIds?: ReadonlySet<string>;
  } = {},
): SectionPair[] {
  const signatures = createReviewSignatureCache();
  const parentKey = (element: Element) => {
    const parent = element.parentElement;
    // The panel key is disposable review markup for element compatibility, but
    // it is persistent pairing context: identical sections must not migrate
    // across independently paired panels merely because their parents look
    // alike after presentation attributes are ignored.
    const panelPath = panelPathForElement(element);
    const panelContext = panelPath.length
      ? `\u0000panel-path:${panelPath.join("\u0001")}`
      : "";
    return parent
      ? `section-parent:${selfCompatibilitySignature(parent, signatures)}${panelContext}`
      : `section-document${panelContext}`;
  };
  return alignReviewSemanticUnits(
    before.map((element) => sectionElementDescriptor(
      element,
      parentKey(element),
      signatures,
      options.usePersistentIdentity !== false,
      options.ambiguousPersistentIds,
    )),
    after.map((element) => sectionElementDescriptor(
      element,
      parentKey(element),
      signatures,
      options.usePersistentIdentity !== false,
      options.ambiguousPersistentIds,
    )),
  ).map((pair) => ({
    before: pair.beforeIndex === null ? null : before[pair.beforeIndex],
    after: pair.afterIndex === null ? null : after[pair.afterIndex],
    beforeIndex: pair.beforeIndex ?? -1,
    afterIndex: pair.afterIndex ?? -1,
  }));
}
