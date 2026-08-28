import {
  PAGE_TAB_STATE_CLASS_NAMES,
  pageTabAssociations,
} from "../../lib/page-presentation-dom";
import {
  appendTrustedReviewProjectionFact,
  parseReviewProjectionFacts,
  serializeReviewProjectionFacts,
} from "../../lib/review-projection-facts.js";
import type {
  ReviewProjectionFact,
} from "../../lib/review-projection-facts.js";
import { reviewSectionChangeOperation } from "../../lib/review-section-operation.js";
import {
  REVIEW_SOURCE_NODE_ATTRIBUTE,
} from "../../lib/review-comment-source-map.js";
import {
  REVIEW_BASE_ATTRIBUTE,
  REVIEW_BOOTSTRAP_ATTRIBUTE,
  REVIEW_COMMENT_GLOBAL_ATTRIBUTE,
  REVIEW_COMMENT_KEY_ATTRIBUTE,
  REVIEW_COMMENT_MARKUP_ATTRIBUTE_PATTERN,
  REVIEW_PROJECTION_FACTS_ATTRIBUTE,
  REVIEW_STYLE_ID,
  NON_CONTENT_TAGS,
} from "./constants";
import type {
  ReviewAttributeRole,
  ReviewChangeType,
  ReviewSignatureCache,
  ReviewTextInventory,
  SectionPair,
} from "./types";

export function reviewTextInventoryForNodes(sourceNodes: Iterable<Node>): ReviewTextInventory {
  const nodes: ReviewTextInventory["nodes"] = [];
  const breakOffsets: number[] = [];
  let text = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (
        !parent
        || parent.closest("script, style, noscript, template")
        || parent.namespaceURI !== "http://www.w3.org/1999/xhtml"
      ) return;
      const value = node.textContent || "";
      const start = text.length;
      text += value;
      nodes.push({ node: node as Text, start, end: text.length, nodeOffset: 0 });
      return;
    }
    if (!(node instanceof Element)) return;
    if (NON_CONTENT_TAGS.has(node.tagName)) return;
    if (node.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
    if (node.tagName === "BR") {
      breakOffsets.push(text.length);
      return;
    }
    node.childNodes.forEach(visit);
  };
  for (const node of sourceNodes) visit(node);
  return { text, nodes, breakOffsets };
}

export function reviewTextInventory(element: Element | null): ReviewTextInventory {
  return element
    ? reviewTextInventoryForNodes(element.childNodes)
    : { text: "", nodes: [], breakOffsets: [] };
}

export const normalizedTextCache = new WeakMap<Element, string>();
export const normalizedMarkupCache = new WeakMap<Element, string>();
export const classTokenCache = new WeakMap<Element, string[]>();
export const conciseTextCache = new WeakMap<Element, string>();

export function normalizedText(element: Element | null): string {
  if (!element) return "";
  const cached = normalizedTextCache.get(element);
  if (cached !== undefined) return cached;
  const value = reviewTextInventory(element).text.replace(/\s+/g, " ").trim();
  normalizedTextCache.set(element, value);
  return value;
}

export function normalizedMarkup(element: Element): string {
  const cached = normalizedMarkupCache.get(element);
  if (cached !== undefined) return cached;
  const value = element.outerHTML
    .replace(REVIEW_COMMENT_MARKUP_ATTRIBUTE_PATTERN, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
  normalizedMarkupCache.set(element, value);
  return value;
}

export function reviewStylesheetSignature(document: Document): string {
  return [...document.querySelectorAll("style, link[rel~='stylesheet' i]")]
    .map((element) => normalizedMarkup(element))
    .join("\u001e");
}

export function ancestorMarkupSignature(element: Element): string {
  const ancestors: string[] = [];
  let current = element.parentElement;
  while (current) {
    ancestors.push([
      current.tagName,
      [...current.attributes]
        .filter((attribute) => (
          attribute.name !== REVIEW_COMMENT_KEY_ATTRIBUTE
          && attribute.name !== REVIEW_COMMENT_GLOBAL_ATTRIBUTE
        ))
        .map((attribute) => `${attribute.name}=${attribute.value}`)
        .sort()
        .join("\u001f"),
    ].join("\u0000"));
    current = current.parentElement;
  }
  return ancestors.join("\u001e");
}

export const PRESENTATION_ATTRIBUTE_NAMES = new Set([
  "align",
  "aria-hidden",
  "bgcolor",
  "cellpadding",
  "cellspacing",
  "class",
  "color",
  "d",
  "data-state",
  "fill",
  "height",
  "hidden",
  "marker-end",
  "marker-mid",
  "marker-start",
  "media",
  "opacity",
  "pathlength",
  "points",
  "poster",
  "preserveaspectratio",
  "r",
  "rx",
  "ry",
  "sizes",
  "src",
  "srcset",
  "stroke",
  "style",
  "transform",
  "valign",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

export const REVIEW_STABLE_IDENTITY_ATTRIBUTE_NAMES = new Set([
  "id",
  "data-test-module",
  "data-native-case",
  "data-section",
  "data-page",
  "data-p",
  "data-tab",
]);

export function createReviewSignatureCache(): ReviewSignatureCache {
  return {
    stableIdentity: new WeakMap<Element, string | null>(),
    selfCompatibility: new WeakMap<Element, string>(),
    exactSubtree: new WeakMap<Element, string>(),
  };
}

export function reviewAttributeRole(attribute: Attr): ReviewAttributeRole {
  const name = attribute.name.toLowerCase();
  if (name.startsWith("data-pageroot-")) return "disposable";
  if (REVIEW_STABLE_IDENTITY_ATTRIBUTE_NAMES.has(name)) return "stable-identity";
  if (PRESENTATION_ATTRIBUTE_NAMES.has(name)) return "presentation";
  return "structural";
}

export function explicitStableElementIdentity(element: Element): string | null {
  for (const name of [
    "id",
    "data-test-module",
    "data-native-case",
    "data-section",
    "data-page",
    "data-p",
    "data-tab",
  ]) {
    const value = element.getAttribute(name)?.trim();
    if (value) return `${name}:${value}`;
  }
  return null;
}

export function stableElementIdentity(element: Element, signatures: ReviewSignatureCache): string | null {
  const cached = signatures.stableIdentity.get(element);
  if (cached !== undefined) return cached;
  const value = explicitStableElementIdentity(element);
  signatures.stableIdentity.set(element, value);
  return value;
}

export function selfCompatibilitySignature(element: Element, signatures: ReviewSignatureCache): string {
  const cached = signatures.selfCompatibility.get(element);
  if (cached !== undefined) return cached;
  const attributes = [...element.attributes]
    .filter((attribute) => {
      const role = reviewAttributeRole(attribute);
      return role === "stable-identity" || role === "structural";
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => `${attribute.name.toLowerCase()}=${attribute.value}`);
  const value = [element.namespaceURI || "", element.localName.toLowerCase(), ...attributes]
    .join("\u0000");
  signatures.selfCompatibility.set(element, value);
  return value;
}

export function exactSubtreeSignature(element: Element, signatures: ReviewSignatureCache): string {
  const cached = signatures.exactSubtree.get(element);
  if (cached !== undefined) return cached;
  const value = element.outerHTML
    .replace(REVIEW_COMMENT_MARKUP_ATTRIBUTE_PATTERN, "")
    .replace(/\sdata-pageroot-(?:review|ai-review|outline-id)[^=\s]*="[^"]*"/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/>\s+</gu, "><")
    .trim();
  signatures.exactSubtree.set(element, value);
  return value;
}

export function classTokens(element: Element): string[] {
  const cached = classTokenCache.get(element);
  if (cached) return cached;
  const value = [...element.classList].map((token) => token.toLowerCase());
  classTokenCache.set(element, value);
  return value;
}

export function hasClassRole(element: Element, roles: string[]): boolean {
  return classTokens(element).some((token) => roles.some((role) => (
    token === role
    || token.startsWith(`${role}-`)
    || token.endsWith(`-${role}`)
    || token.includes(`-${role}-`)
  )));
}

export function directHeading(element: Element): Element | null {
  if (element.matches("h1, h2, h3, h4, h5, h6, [role='heading']")) return element;
  const semanticHeading = element.querySelector(
    ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role='heading'], :scope > header h1, :scope > header h2, :scope > header h3, :scope > header h4",
  );
  if (semanticHeading) return semanticHeading;
  const namedCandidates = [...element.querySelectorAll("[class], [aria-label]")];
  return namedCandidates.find((candidate) => (
    hasClassRole(candidate, ["heading", "title", "header"])
    && !hasClassRole(candidate, ["sub", "subtitle", "note", "meta"])
    && normalizedText(candidate).length > 0
  )) || element.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
}

export function conciseElementText(element: Element | null): string {
  if (!element) return "";
  const cached = conciseTextCache.get(element);
  if (cached !== undefined) return cached;
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(
    "script, style, noscript, template, small, .sub, .subtitle, [class*='subtitle'], [class*='meta']",
  ).forEach((candidate) => candidate.remove());
  const value = (clone.textContent || "").replace(/\s+/g, " ").trim();
  conciseTextCache.set(element, value);
  return value;
}

export function changeLabel(
  before: Element | null,
  after: Element | null,
  index: number,
): string {
  const preferred = after || before;
  if (!preferred) return `页面区域 ${index + 1}`;
  const heading = directHeading(preferred);
  const semanticLabel = preferred.matches("nav, [role='navigation']")
    ? "页面导航"
    : preferred.matches("header")
      ? "页面页头"
      : preferred.matches("footer")
        ? "页面结尾"
        : preferred.matches("table")
          ? conciseElementText(preferred.querySelector(":scope > caption")) || "数据表格"
          : preferred.matches("form")
            ? conciseElementText(preferred.querySelector(":scope > fieldset > legend")) || "表单区域"
            : preferred.matches("img, picture, figure")
              ? preferred.querySelector("img")?.getAttribute("alt") || "图片区域"
              : "";
  const readableId = preferred.id && !/^\d+$/u.test(preferred.id)
    ? preferred.id.replace(/[-_]+/g, " ").trim()
    : "";
  const directCopy = preferred.childElementCount <= 3
    ? conciseElementText(preferred)
    : "";
  const label = conciseElementText(heading)
    || preferred.getAttribute("aria-label")
    || preferred.getAttribute("data-title")
    || semanticLabel
    || readableId
    || directCopy
    || `页面区域 ${index + 1}`;
  return label.length > 48 ? `${label.slice(0, 48)}…` : label;
}

export function eligibleChildren(element: Element): Element[] {
  return [...element.children].filter((child) => !NON_CONTENT_TAGS.has(child.tagName));
}

export function hasReviewableContent(element: Element): boolean {
  return normalizedText(element).length > 1
    || element.matches("img, picture, svg, canvas, table, form, video, audio, iframe")
    || Boolean(element.querySelector("img, picture, svg, canvas, table, form, video, audio, iframe"));
}

export function isPanelContainer(element: Element): boolean {
  const role = element.getAttribute("role");
  if (role === "tabpanel") return true;
  if (
    element.hasAttribute("data-tab-panel")
    || element.hasAttribute("data-page")
    || element.hasAttribute("data-panel")
  ) return true;
  return Boolean(element.id) && hasClassRole(element, ["panel", "page", "slide", "tab", "view"]);
}

export function closestPanelContainer(element: Element): Element | null {
  let candidate: Element | null = element;
  while (candidate && candidate !== element.ownerDocument.body) {
    if (
      candidate.getAttribute("data-pageroot-review-panel-container") === "true"
      || isPanelContainer(candidate)
    ) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

export function safePanelControls(document: Document): Element[] {
  const explicit = pageTabAssociations(document, { detached: true })
    .map((association) => association.control);
  const likely = [...document.querySelectorAll(
    'button, a[href^="#"], [role="button"], input[type="radio"]',
  )].filter((element) => (
    hasClassRole(element, ["tab", "nav", "page"])
    || Boolean(element.closest('[role="tablist"], nav, [class*="tab" i], [class*="nav" i]'))
  ));
  return [...new Set([...explicit, ...likely])];
}

export function panelControlTarget(control: Element): string {
  return control.getAttribute("aria-controls")
    || control.getAttribute("data-p")
    || control.getAttribute("data-tab")
    || control.getAttribute("href")?.replace(/^#/u, "")
    || "";
}

export function controlMatchesPanel(control: Element, panel: Element): boolean {
  const target = panelControlTarget(control);
  const panelIdentity = panel.id
    || panel.getAttribute("data-page")
    || panel.getAttribute("data-tab-panel")
    || "";
  return Boolean(target && panelIdentity) && (
    target === panelIdentity
    || `p${target}` === panelIdentity
    || target === panelIdentity.replace(/^p(?=\d+$)/u, "")
  );
}

export function normalizedPanelLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 80);
}

export type PanelDescriptor = {
  panel: Element;
  control: Element | null;
  explicitIdentity: string;
  label: string;
  groupKey: string;
  activeClasses: string[];
  index: number;
};

export function panelDescriptors(document: Document): PanelDescriptor[] {
  const associations = pageTabAssociations(document, { detached: true });
  const associatedPanels = new Set(associations.map((association) => association.panel));
  const panels = [
    ...associations.map((association) => association.panel),
    ...[...document.querySelectorAll("body *")]
      .filter(isPanelContainer)
      .filter((panel) => !associatedPanels.has(panel as HTMLElement)),
  ];
  const controls = safePanelControls(document);
  return panels.map((panel, index) => {
    const association = associations.find((candidate) => candidate.panel === panel);
    const control = association?.control
      || controls.find((candidate) => controlMatchesPanel(candidate, panel))
      || (controls.length === panels.length ? controls[index] : null);
    const activeClasses = PAGE_TAB_STATE_CLASS_NAMES.filter((className) => (
      Boolean(control?.classList.contains(className))
      || panel.classList.contains(className)
    ));
    return {
      panel,
      control,
      groupKey: association?.groupKey || `loose-panel-${index + 1}`,
      activeClasses,
      explicitIdentity: normalizedPanelLabel(
        panel.id
        || panel.getAttribute("data-page")
        || panel.getAttribute("data-tab-panel")
        || panelControlTarget(control || panel),
      ),
      label: normalizedPanelLabel(
        conciseElementText(control)
        || panel.getAttribute("aria-label")
        || conciseElementText(directHeading(panel)),
      ),
      index,
    };
  });
}

export function setPanelDescriptorKey(descriptor: PanelDescriptor, key: string) {
  descriptor.panel.setAttribute("data-pageroot-review-panel-key", key);
  descriptor.panel.setAttribute("data-pageroot-review-panel-container", "true");
  descriptor.panel.setAttribute("data-pageroot-review-panel-group", descriptor.groupKey);
  if (descriptor.activeClasses.length) {
    descriptor.panel.setAttribute(
      "data-pageroot-review-panel-active-classes",
      descriptor.activeClasses.join(" "),
    );
  }
  if (descriptor.control) {
    descriptor.control.setAttribute("data-pageroot-review-panel-key", key);
    descriptor.control.setAttribute("data-pageroot-review-panel-control", "true");
    descriptor.control.setAttribute("data-pageroot-review-panel-group", descriptor.groupKey);
    if (descriptor.activeClasses.length) {
      descriptor.control.setAttribute(
        "data-pageroot-review-panel-active-classes",
        descriptor.activeClasses.join(" "),
      );
    }
  }
}

export function annotatePanelPaths(document: Document) {
  document.querySelectorAll<HTMLElement>("[data-pageroot-review-panel-key]")
    .forEach((element) => {
      const keys: string[] = [];
      let candidate: Element | null = element;
      while (candidate && candidate !== document.body) {
        if (
          candidate.getAttribute("data-pageroot-review-panel-container") === "true"
          || candidate === element
        ) {
          const key = candidate.getAttribute("data-pageroot-review-panel-key");
          if (key && !keys.includes(key)) keys.unshift(key);
        }
        candidate = candidate.parentElement;
      }
      element.setAttribute("data-pageroot-review-panel-path", keys.join(" "));
    });
}

export function annotatePanelPairs(before: Document, after: Document) {
  const beforePanels = panelDescriptors(before);
  const afterPanels = panelDescriptors(after);
  const usedAfter = new Set<PanelDescriptor>();
  let pairIndex = 0;
  beforePanels.forEach((beforePanel) => {
    const ranked = afterPanels
      .filter((candidate) => !usedAfter.has(candidate))
      .map((candidate) => ({
        candidate,
        score:
          (beforePanel.explicitIdentity
            && beforePanel.explicitIdentity === candidate.explicitIdentity ? 160 : 0)
          + (beforePanel.label && beforePanel.label === candidate.label ? 90 : 0)
          + Math.max(0, 35 - Math.abs(beforePanel.index - candidate.index) * 8),
      }))
      .sort((left, right) => right.score - left.score);
    const match = (ranked[0]?.score || 0) >= 27 ? ranked[0].candidate : null;
    pairIndex += 1;
    const key = `panel-${pairIndex}`;
    setPanelDescriptorKey(beforePanel, key);
    if (match) {
      usedAfter.add(match);
      setPanelDescriptorKey(match, key);
    }
  });
  afterPanels.forEach((descriptor) => {
    if (usedAfter.has(descriptor)) return;
    pairIndex += 1;
    setPanelDescriptorKey(descriptor, `panel-${pairIndex}`);
  });
  annotatePanelPaths(before);
  annotatePanelPaths(after);
}

export type ActionDescriptor = {
  element: Element;
  explicitIdentity: string;
  label: string;
  kind: string;
  panelKey: string;
  ordinal: number;
  index: number;
};

export function actionDescriptors(document: Document): ActionDescriptor[] {
  const actions = [...document.querySelectorAll(
    'a[href], area[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [aria-expanded][aria-controls], [onclick]',
  )];
  const ordinals = new Map<string, number>();
  return actions.map((element, index) => {
    const panelKey = element.closest("[data-pageroot-review-panel-key]")
      ?.getAttribute("data-pageroot-review-panel-key") || "";
    const kind = `${element.tagName.toLowerCase()}:${element.getAttribute("role") || ""}:${element.getAttribute("type") || ""}`;
    const ordinalGroup = `${panelKey || "page"}:${kind}`;
    const ordinal = (ordinals.get(ordinalGroup) || 0) + 1;
    ordinals.set(ordinalGroup, ordinal);
    return {
      element,
      panelKey,
      kind,
      ordinal,
      index,
      explicitIdentity: normalizedPanelLabel([
        element.id,
        element.getAttribute("name"),
        element.getAttribute("aria-controls"),
        element.getAttribute("data-p"),
        element.getAttribute("data-tab"),
        element.getAttribute("data-page"),
        element.getAttribute("href"),
      ].find((value) => Boolean(value?.trim())) || ""),
      label: normalizedPanelLabel(
        element.getAttribute("aria-label")
        || element.getAttribute("title")
        || conciseElementText(element),
      ),
    };
  });
}

export function annotateActionPairs(before: Document, after: Document) {
  const beforeActions = actionDescriptors(before);
  const afterActions = actionDescriptors(after);
  const afterBuckets = new Map<string, ActionDescriptor[]>();
  afterActions.forEach((action) => {
    const key = `${action.panelKey}\u0000${action.kind}`;
    const bucket = afterBuckets.get(key) ?? [];
    bucket.push(action);
    afterBuckets.set(key, bucket);
  });
  const usedAfter = new Set<ActionDescriptor>();
  let pairIndex = 0;
  beforeActions.forEach((beforeAction) => {
    const ranked = (afterBuckets.get(
      `${beforeAction.panelKey}\u0000${beforeAction.kind}`,
    ) ?? [])
      .filter((candidate) => !usedAfter.has(candidate))
      .map((candidate) => {
        return {
          candidate,
          score: 45
            + (beforeAction.explicitIdentity
              && beforeAction.explicitIdentity === candidate.explicitIdentity ? 120 : 0)
            + (beforeAction.label && beforeAction.label === candidate.label ? 55 : 0)
            + (beforeAction.ordinal === candidate.ordinal ? 35 : 0)
            + Math.max(0, 18 - Math.abs(beforeAction.index - candidate.index) * 3),
        };
      })
      .sort((left, right) => right.score - left.score);
    const match = (ranked[0]?.score || 0) >= 45 ? ranked[0].candidate : null;
    pairIndex += 1;
    const key = `action-${pairIndex}`;
    beforeAction.element.setAttribute("data-pageroot-review-action-key", key);
    if (match) {
      usedAfter.add(match);
      match.element.setAttribute("data-pageroot-review-action-key", key);
    }
  });
  afterActions.forEach((descriptor) => {
    if (usedAfter.has(descriptor)) return;
    pairIndex += 1;
    descriptor.element.setAttribute("data-pageroot-review-action-key", `action-${pairIndex}`);
  });
}

export function panelPathForElement(element: Element | null): string[] {
  if (!element) return [];
  const path: string[] = [];
  let candidate: Element | null = element;
  while (candidate && candidate !== element.ownerDocument.body) {
    if (candidate.getAttribute("data-pageroot-review-panel-container") === "true") {
      const key = candidate.getAttribute("data-pageroot-review-panel-key");
      if (key && !path.includes(key)) path.unshift(key);
    }
    candidate = candidate.parentElement;
  }
  return path;
}

export function isGenericContentContainer(element: Element): boolean {
  if (element.matches("main, [role='main']")) return true;
  return hasClassRole(element, [
    "container",
    "content",
    "main",
    "pages",
    "panels",
    "root",
    "slides",
    "wrap",
    "wrapper",
  ]);
}

export function contentRoot(document: Document): Element | null {
  const main = document.querySelector("main, [role='main']");
  if (main) return main;
  if (!document.body) return null;
  const bodyChildren = eligibleChildren(document.body).filter(hasReviewableContent);
  if (
    bodyChildren.length === 1
    && eligibleChildren(bodyChildren[0]).filter(hasReviewableContent).length > 1
  ) return bodyChildren[0];
  return document.body;
}

export function candidateSections(document: Document): Element[] {
  const root = contentRoot(document);
  if (!root) return [];
  const regions: Element[] = [];

  const collect = (container: Element, depth: number) => {
    const children = eligibleChildren(container).filter(hasReviewableContent);
    children.forEach((child) => {
      const childRegions = eligibleChildren(child).filter(hasReviewableContent);
      const shouldExpand = depth < 5
        && childRegions.length > 1
        && (isPanelContainer(child) || isGenericContentContainer(child));
      if (shouldExpand) {
        collect(child, depth + 1);
      } else {
        regions.push(child);
      }
    });
  };

  // The content root is the densest part of the page, but a single-file HTML
  // page has no site chrome to skip: a footer note, a header line or a nav
  // block outside it is authored content, and a rewrite there must stay
  // reviewable. Body-level siblings therefore become their own regions, in
  // document order, while the root keeps expanding from depth 0 exactly as
  // before so region granularity inside it does not shift.
  const bodyChildren = document.body && root !== document.body
    ? eligibleChildren(document.body).filter(hasReviewableContent)
    : [];
  const rootOwner = bodyChildren.find((child) => child === root || child.contains(root));
  if (rootOwner) {
    bodyChildren.forEach((child) => {
      if (child === rootOwner) collect(root, 0);
      else regions.push(child);
    });
  } else {
    collect(root, 0);
  }
  if (!regions.length && hasReviewableContent(root)) regions.push(root);
  return regions;
}

export function sourceElementsByNodeId(document: Document): Map<string, Element> {
  const elements = new Map<string, Element>();
  document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    const sourceNodeId = element.getAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    if (sourceNodeId) elements.set(sourceNodeId, element);
  });
  return elements;
}

/**
 * Collects the section's insertion/removal evidence for
 * `reviewSectionChangeOperation`. Only marker elements are visited, so this
 * stays far cheaper than the full-subtree walk the marker pass performs later.
 */
export function sectionChangeMarks(pair: SectionPair) {
  const marks: { textOperation: string; structureTone: string }[] = [];
  const collect = (element: Element) => {
    marks.push({
      textOperation: element.hasAttribute("data-pageroot-review-text")
        ? element.getAttribute("data-pageroot-review-text-operation") || ""
        : "",
      structureTone: element.getAttribute("data-pageroot-review-structure") || "",
    });
  };
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    collect(root);
    root
      .querySelectorAll("[data-pageroot-review-text],[data-pageroot-review-structure]")
      .forEach(collect);
  });
  return marks;
}

export function helperText(
  types: ReviewChangeType[],
  beforePresent: boolean,
  afterPresent: boolean,
  pair?: SectionPair,
): string {
  if (!beforePresent) return "新增元素";
  if (!afterPresent) return "删除元素";
  // A section that exists on both sides can still be a pure insertion or
  // removal inside itself; presence alone cannot express that.
  const operation = pair ? reviewSectionChangeOperation(sectionChangeMarks(pair)) : null;
  if (operation === "insert") return "新增元素";
  if (operation === "delete") return "删除元素";
  const labels = types.map((type) => (
    type === "text" ? "文字" : "元素"
  ));
  return `${[...new Set(labels)].join("、")}调整`;
}

export function panelControlLabel(document: Document, panel: Element): string {
  const association = pageTabAssociations(document, { detached: true })
    .find((candidate) => candidate.panel === panel);
  if (association?.label) return association.label;
  const controls = safePanelControls(document);
  const panelId = panel.id
    || panel.getAttribute("data-page")
    || panel.getAttribute("data-tab-panel")
    || "";
  const control = controls.find((candidate) => (
    candidate.getAttribute("aria-controls") === panelId
    || candidate.getAttribute("data-p") === panelId
    || candidate.getAttribute("data-tab") === panelId
    || (panelId.startsWith("p") && candidate.getAttribute("data-p") === panelId.slice(1))
  ));
  if (control) return conciseElementText(control);
  const panels = [...document.querySelectorAll("body *")].filter(isPanelContainer);
  const panelIndex = panels.indexOf(panel);
  if (panelIndex >= 0 && panels.length === controls.length) {
    return conciseElementText(controls[panelIndex] || null);
  }
  return "";
}

export function regionGroupLabel(element: Element | null, document: Document): string {
  if (!element) return "页面内容";
  const panel = closestPanelContainer(element);
  if (panel) {
    const controlLabel = panelControlLabel(document, panel);
    const panelLabel = controlLabel
      || panel.getAttribute("aria-label")
      || conciseElementText(directHeading(panel));
    if (panelLabel) return panelLabel.length > 48 ? `${panelLabel.slice(0, 48)}…` : panelLabel;
  }
  if (element.matches("nav, [role='navigation'], [role='tablist']") || hasClassRole(element, ["nav", "tabs"])) {
    return "页面导航";
  }
  if (element.matches("header, h1") || Boolean(element.querySelector(":scope > h1"))) {
    return "页面概览";
  }
  if (element.matches("footer")) return "页面结尾";
  return "页面内容";
}

export const REVIEW_TEXT_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BUTTON",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

export function isReviewTextBlockElement(element: Element): boolean {
  return element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && REVIEW_TEXT_BLOCK_TAGS.has(element.tagName);
}

export function sliceReviewTextInventory(
  inventory: ReviewTextInventory,
  start: number,
  end: number,
): ReviewTextInventory {
  return {
    text: inventory.text.slice(start, end),
    nodes: inventory.nodes
      .filter((entry) => entry.end > start && entry.start < end)
      .map((entry) => ({
        node: entry.node,
        start: Math.max(entry.start, start) - start,
        end: Math.min(entry.end, end) - start,
        nodeOffset: entry.nodeOffset + Math.max(0, start - entry.start),
      })),
    breakOffsets: inventory.breakOffsets
      .filter((offset) => offset > start && offset < end)
      .map((offset) => offset - start),
  };
}

export const NUMBERED_TEXT_LINE_PATTERN = /^\s*(?:[\u2460-\u2473]|[（(]?\d+[）).、:：]|[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+[）、.]|[•·▪◦●]|[-–—])\s*/u;

export const GENERIC_REVIEW_TEXT_CLASSES = new Set([
    "active", "card", "col", "column", "container", "content", "grid", "item",
    "main", "panel", "row", "section", "selected", "wrap", "wrapper",
]);

export function reviewProjectionFactsForElement(element: Element): ReviewProjectionFact[] {
  return parseReviewProjectionFacts(element.getAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE));
}

export function appendProjectionFactToElement(
  element: Element,
  fact: ReviewProjectionFact,
) {
  const facts = appendTrustedReviewProjectionFact(reviewProjectionFactsForElement(element), fact);
  element.setAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE, serializeReviewProjectionFacts(facts));
}

export function clearReservedReviewMarkup(
  document: Document,
  preserveSourceNodeIdentity = false,
) {
  document.getElementById(REVIEW_STYLE_ID)?.remove();
  document.querySelectorAll(`[${REVIEW_BOOTSTRAP_ATTRIBUTE}]`).forEach((element) => element.remove());
  document.querySelectorAll(`base[${REVIEW_BASE_ATTRIBUTE}]`).forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (
        (
          attribute.name.startsWith("data-pageroot-review-")
          && (!preserveSourceNodeIdentity || attribute.name !== REVIEW_SOURCE_NODE_ATTRIBUTE)
        )
        || attribute.name === "data-pageroot-outline-id"
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });
}
