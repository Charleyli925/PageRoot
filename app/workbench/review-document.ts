import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor.types";
import {
  PAGE_TAB_STATE_CLASS_NAMES,
  pageTabAssociations,
} from "../lib/page-presentation-dom";
import {
  buildSourceIndex,
} from "../lib/source-patch-core.js";
import {
  mergeReviewTextRanges,
  readableReviewTextFootprintPlan,
  reviewTextSimilarity,
  sentenceAwareTextDifferences,
} from "../lib/review-text-diff.js";
import type {
  ReviewRuntimeVisualCandidate,
} from "../lib/review-runtime-visual.js";
import {
  REVIEW_SOURCE_NODE_ATTRIBUTE,
  prepareReviewCommentSourceProjection,
  resolveReviewCommentSourceElement,
} from "../lib/review-comment-source-map.js";
import type { CommentItem } from "./types";

export type ReviewFilter = "all" | "text" | "structure" | "style";
export type ReviewChangeType = Exclude<ReviewFilter, "all">;
export type ReviewSide = "before" | "after";

export type ReviewChange = {
  id: string;
  label: string;
  helper: string;
  types: ReviewChangeType[];
  beforePresent: boolean;
  afterPresent: boolean;
  panelKey?: string;
  panelPath?: string[];
  movement?: { from: number; to: number };
};

export type ReviewOutlineItem = {
  id: string;
  group: string;
  label: string;
  helper: string;
  changeId?: string;
  panelKey?: string;
  panelPath?: string[];
  types: ReviewChangeType[];
  movement?: { from: number; to: number };
};

export type ReviewDocuments = {
  before: string;
  after: string;
  bootstrapJavaScript: Record<ReviewSide, string>;
  changes: ReviewChange[];
  outline: ReviewOutlineItem[];
  runtimeVisualCandidates: ReviewRuntimeVisualCandidate[];
  commentGroups: ReviewCommentGroup[];
};

export type ReviewCommentGroup = {
  key: string;
  items: Array<{
    text: string;
    attachmentCount: number;
  }>;
};

const REVIEW_STYLE_ID = "pageroot-ai-review-style";
const REVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-ai-review-bootstrap";
const REVIEW_BASE_ATTRIBUTE = "data-pageroot-ai-review-base";
const REVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";
const REVIEW_DOCUMENT_STYLE = String.raw`
  html {
    --pageroot-review-context-opacity: .18;
    --pageroot-review-context-grayscale: .45;
    --pageroot-review-context-saturation: .75;
    --pageroot-review-ui-scale: 1;
    scroll-behavior: auto !important;
    overflow-anchor: none !important;
  }

  body {
    scroll-behavior: auto !important;
    overflow-anchor: none !important;
  }

  [data-pageroot-outline-id] {
    transition: opacity 160ms ease, filter 160ms ease, outline-color 120ms ease !important;
  }

  html[data-pageroot-review-filter="all"] [data-pageroot-review-marker-types~="structure"],
  html[data-pageroot-review-filter="all"] [data-pageroot-review-marker-types~="style"],
  html[data-pageroot-review-filter="structure"] [data-pageroot-review-marker-types~="structure"],
  html[data-pageroot-review-filter="style"] [data-pageroot-review-marker-types~="style"] {
    position: relative !important;
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed #1677c8 !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-filter="structure"] [data-pageroot-review-marker-types~="structure"] {
    outline-color: #1677c8 !important;
  }

  html[data-pageroot-review-filter="style"] [data-pageroot-review-marker-types~="style"] {
    outline-color: #6d5ce7 !important;
  }

  html[data-pageroot-review-filter="all"] [data-pageroot-review-text="removed"],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="removed"] {
    background: transparent !important;
    color: #a13f3b !important;
    text-decoration-line: line-through !important;
    text-decoration-style: dashed !important;
    text-decoration-color: #c74f4a !important;
    text-decoration-thickness: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-filter="all"] [data-pageroot-review-text="added"],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="added"] {
    background: transparent !important;
    color: inherit !important;
    text-decoration: none !important;
  }

  html[data-pageroot-review-filter="style"] [data-pageroot-review-marker-types~="style"] {
    box-shadow: none !important;
  }

  html[data-pageroot-review-overlays="true"] [data-pageroot-review-marker] {
    outline: none !important;
  }

  [data-pageroot-review-projection-layer] {
    position: absolute !important;
    z-index: 2147482500 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-pageroot-review-mask-layer] {
    position: absolute !important;
    z-index: 0 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    overflow: visible !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-pageroot-review-mask-dim] {
    fill: #ffffff !important;
    fill-rule: evenodd !important;
    stroke: none !important;
  }

  [data-pageroot-review-mask-hole] {
    display: none !important;
    fill: none !important;
    stroke: none !important;
  }

  [data-pageroot-review-overlay-box] {
    position: absolute !important;
    z-index: 1 !important;
    display: block !important;
    overflow: visible !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: calc(2px * var(--pageroot-review-ui-scale)) dashed #1677c8 !important;
    border-radius: calc(5px * var(--pageroot-review-ui-scale)) !important;
    background: transparent !important;
    box-shadow: none !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-pageroot-review-overlay-box][data-tone="text-removed"] {
    border-color: #d14b44 !important;
  }

  [data-pageroot-review-overlay-box][data-tone="text-added"] {
    border-color: #239b56 !important;
  }

  [data-pageroot-review-overlay-box][data-tone="structure"] {
    border-color: #1677c8 !important;
  }

  [data-pageroot-review-overlay-box][data-tone="style"],
  [data-pageroot-review-overlay-box][data-tone="mixed"] {
    border-color: #6d5ce7 !important;
  }

  [data-pageroot-review-overlay-box][data-shaped="true"] {
    border: 0 !important;
  }

  [data-pageroot-review-overlay-shape-svg] {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    overflow: visible !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-pageroot-review-overlay-shape] {
    display: block !important;
    fill: none !important;
    stroke: #1677c8 !important;
    stroke-width: calc(2px * var(--pageroot-review-ui-scale)) !important;
    stroke-dasharray: calc(6px * var(--pageroot-review-ui-scale)) calc(4px * var(--pageroot-review-ui-scale)) !important;
    stroke-linejoin: round !important;
    stroke-linecap: round !important;
    vector-effect: non-scaling-stroke !important;
  }

  [data-pageroot-review-overlay-box][data-tone="text-removed"] [data-pageroot-review-overlay-shape] {
    stroke: #d14b44 !important;
  }

  [data-pageroot-review-overlay-box][data-tone="text-added"] [data-pageroot-review-overlay-shape] {
    stroke: #239b56 !important;
  }

  [data-pageroot-review-overlay-box][data-tone="style"] [data-pageroot-review-overlay-shape],
  [data-pageroot-review-overlay-box][data-tone="mixed"] [data-pageroot-review-overlay-shape] {
    stroke: #6d5ce7 !important;
  }

  [data-pageroot-review-overlay-label] {
    position: absolute !important;
    right: 0 !important;
    bottom: calc(100% + 4px) !important;
    z-index: 2 !important;
    display: inline-flex !important;
    align-items: center !important;
    min-height: calc(19px * var(--pageroot-review-ui-scale)) !important;
    max-width: min(320px, calc(100vw - 24px)) !important;
    padding: calc(3px * var(--pageroot-review-ui-scale)) calc(7px * var(--pageroot-review-ui-scale)) !important;
    overflow: hidden !important;
    border: 1px solid rgb(98 88 214 / 24%) !important;
    border-radius: calc(6px * var(--pageroot-review-ui-scale)) !important;
    background: rgb(255 255 255 / 94%) !important;
    color: #514ba9 !important;
    box-shadow: 0 4px 12px rgb(30 25 70 / 12%) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: calc(10px * var(--pageroot-review-ui-scale)) !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
  }

  [data-pageroot-review-transition-mask] {
    position: absolute !important;
    z-index: 2147482490 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: #ffffff !important;
    pointer-events: none !important;
  }

  html:not([data-pageroot-review-overlays="true"])[data-pageroot-review-filter]
    [data-pageroot-review-marker][data-pageroot-review-primary="true"][data-pageroot-review-active="true"]::after {
    position: absolute !important;
    z-index: 2147483000 !important;
    top: calc(-24px * var(--pageroot-review-ui-scale)) !important;
    right: 0 !important;
    display: inline-flex !important;
    align-items: center !important;
    min-height: calc(19px * var(--pageroot-review-ui-scale)) !important;
    max-width: min(320px, calc(100vw - 24px)) !important;
    padding: 0 calc(7px * var(--pageroot-review-ui-scale)) !important;
    border: 1px solid rgb(98 88 214 / 24%) !important;
    border-radius: calc(6px * var(--pageroot-review-ui-scale)) !important;
    background: rgb(255 255 255 / 94%) !important;
    color: #514ba9 !important;
    box-shadow: 0 4px 12px rgb(30 25 70 / 12%) !important;
    content: attr(data-pageroot-review-summary) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: calc(10px * var(--pageroot-review-ui-scale)) !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
    letter-spacing: 0 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    pointer-events: none !important;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-pageroot-outline-id] { transition: none !important; }
  }
`;

const NON_CONTENT_TAGS = new Set([
  "BASE",
  "LINK",
  "META",
  "NOSCRIPT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
]);

const REVIEW_RUNTIME_VISUAL_HOST_ATTRIBUTE = "data-pageroot-review-runtime-host";
const REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTE = "data-pageroot-review-runtime-source-box";
const REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES = [
  "class",
  "height",
  "hidden",
  "style",
  "width",
];
const MAX_REVIEW_RUNTIME_VISUAL_CANDIDATES = 128;
const RUNTIME_VISUAL_HOST_SELECTOR = [
  "article",
  "aside",
  "canvas",
  "div",
  "figure",
  "figcaption",
  "li",
  "main",
  "section",
  "span",
  "svg",
  "td",
  "th",
  "tbody",
].join(",");
const GENERIC_RUNTIME_VISUAL_CLASSES = new Set([
  "active",
  "card",
  "chart",
  "container",
  "content",
  "grid",
  "item",
  "main",
  "panel",
  "row",
  "section",
  "wrap",
  "wrapper",
]);

type ReviewTextInventory = {
  text: string;
  nodes: Array<{ node: Text; start: number; end: number }>;
  breakOffsets: number[];
};

function reviewTextInventoryForNodes(sourceNodes: Iterable<Node>): ReviewTextInventory {
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
      nodes.push({ node: node as Text, start, end: text.length });
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

function reviewTextInventory(element: Element | null): ReviewTextInventory {
  return element
    ? reviewTextInventoryForNodes(element.childNodes)
    : { text: "", nodes: [], breakOffsets: [] };
}

function normalizedText(element: Element | null): string {
  return reviewTextInventory(element).text.replace(/\s+/g, " ").trim();
}

function normalizedMarkup(element: Element): string {
  return element.outerHTML
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

const VISUAL_ATTRIBUTE_NAMES = new Set([
  "align",
  "aria-hidden",
  "bgcolor",
  "cellpadding",
  "cellspacing",
  "class",
  "color",
  "data-state",
  "fill",
  "height",
  "hidden",
  "media",
  "poster",
  "sizes",
  "src",
  "srcset",
  "stroke",
  "style",
  "valign",
  "width",
]);

function normalizedCss(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([:;,{}>+~])\s*/g, "$1")
    .trim();
}

function elementVisualSignature(element: Element): string {
  return [...element.attributes]
    .filter((attribute) => VISUAL_ATTRIBUTE_NAMES.has(attribute.name.toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => `${attribute.name.toLowerCase()}=${attribute.value}`)
    .join("\u001f");
}

function classTokens(element: Element): string[] {
  return [...element.classList].map((token) => token.toLowerCase());
}

function hasClassRole(element: Element, roles: string[]): boolean {
  return classTokens(element).some((token) => roles.some((role) => (
    token === role
    || token.startsWith(`${role}-`)
    || token.endsWith(`-${role}`)
    || token.includes(`-${role}-`)
  )));
}

function directHeading(element: Element): Element | null {
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

function conciseElementText(element: Element | null): string {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(
    "script, style, noscript, template, small, .sub, .subtitle, [class*='subtitle'], [class*='meta']",
  ).forEach((candidate) => candidate.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function changeLabel(
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

function eligibleChildren(element: Element): Element[] {
  return [...element.children].filter((child) => !NON_CONTENT_TAGS.has(child.tagName));
}

function hasReviewableContent(element: Element): boolean {
  return normalizedText(element).length > 1
    || element.matches("img, picture, svg, canvas, table, form, video, audio, iframe")
    || Boolean(element.querySelector("img, picture, svg, canvas, table, form, video, audio, iframe"));
}

function isPanelContainer(element: Element): boolean {
  const role = element.getAttribute("role");
  if (role === "tabpanel") return true;
  if (
    element.hasAttribute("data-tab-panel")
    || element.hasAttribute("data-page")
    || element.hasAttribute("data-panel")
  ) return true;
  return Boolean(element.id) && hasClassRole(element, ["panel", "page", "slide", "tab", "view"]);
}

function closestPanelContainer(element: Element): Element | null {
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

function safePanelControls(document: Document): Element[] {
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

function panelControlTarget(control: Element): string {
  return control.getAttribute("aria-controls")
    || control.getAttribute("data-p")
    || control.getAttribute("data-tab")
    || control.getAttribute("href")?.replace(/^#/u, "")
    || "";
}

function controlMatchesPanel(control: Element, panel: Element): boolean {
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

function normalizedPanelLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 80);
}

type PanelDescriptor = {
  panel: Element;
  control: Element | null;
  explicitIdentity: string;
  label: string;
  groupKey: string;
  activeClasses: string[];
  index: number;
};

function panelDescriptors(document: Document): PanelDescriptor[] {
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

function setPanelDescriptorKey(descriptor: PanelDescriptor, key: string) {
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

function annotatePanelPaths(document: Document) {
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

function annotatePanelPairs(before: Document, after: Document) {
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

type ActionDescriptor = {
  element: Element;
  explicitIdentity: string;
  label: string;
  kind: string;
  panelKey: string;
  ordinal: number;
  index: number;
};

function actionDescriptors(document: Document): ActionDescriptor[] {
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

function annotateActionPairs(before: Document, after: Document) {
  const beforeActions = actionDescriptors(before);
  const afterActions = actionDescriptors(after);
  const usedAfter = new Set<ActionDescriptor>();
  let pairIndex = 0;
  beforeActions.forEach((beforeAction) => {
    const ranked = afterActions
      .filter((candidate) => !usedAfter.has(candidate))
      .map((candidate) => {
        if (beforeAction.kind !== candidate.kind) return { candidate, score: -1 };
        if (beforeAction.panelKey !== candidate.panelKey) return { candidate, score: -1 };
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

function panelPathForElement(element: Element | null): string[] {
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

function isGenericContentContainer(element: Element): boolean {
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

function contentRoot(document: Document): Element | null {
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

function candidateSections(document: Document): Element[] {
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

  collect(root, 0);
  if (!regions.length && hasReviewableContent(root)) regions.push(root);
  return regions;
}

function pairKey(element: Element): string | null {
  if (element.id) return `id:${element.id}`;
  for (const attribute of [
    "data-test-module",
    "data-native-case",
    "data-section",
    "data-page",
    "data-p",
    "data-tab",
  ]) {
    const value = element.getAttribute(attribute);
    if (value) return `${attribute}:${value}`;
  }
  return null;
}

function regionContextKey(element: Element): string {
  const panel = closestPanelContainer(element);
  if (!panel) return "page";
  const identity = panel.getAttribute("data-pageroot-review-panel-key")
    || panel.id
    || panel.getAttribute("data-page")
    || panel.getAttribute("aria-label")
    || classTokens(panel).join(".");
  return `panel:${identity || "anonymous"}`;
}

function sectionPairScore(
  before: Element,
  after: Element,
  beforeIndex: number,
  afterIndex: number,
): number {
  if (before.tagName !== after.tagName) return Number.NEGATIVE_INFINITY;
  const beforeKey = pairKey(before);
  const afterKey = pairKey(after);
  if (beforeKey || afterKey) {
    return beforeKey && beforeKey === afterKey
      ? 1_000 - Math.abs(beforeIndex - afterIndex)
      : Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  const beforeContext = regionContextKey(before);
  const afterContext = regionContextKey(after);
  if (beforeContext !== afterContext) return Number.NEGATIVE_INFINITY;

  const beforeClasses = new Set(classTokens(before));
  const sharedClasses = classTokens(after).filter((token) => beforeClasses.has(token));
  const distinctiveClasses = sharedClasses.filter((token) => ![
    "active", "card", "col", "column", "container", "content", "grid", "item",
    "main", "panel", "row", "section", "selected", "wrap", "wrapper",
  ].includes(token));

  const beforeHeading = conciseElementText(directHeading(before));
  const afterHeading = conciseElementText(directHeading(after));
  const headingMatches = Boolean(beforeHeading && beforeHeading === afterHeading);
  const beforeText = normalizedText(before);
  const afterText = normalizedText(after);
  const exactText = Boolean(beforeText && beforeText === afterText);
  const similarity = reviewTextSimilarity(beforeText, afterText);
  const accessibleIdentity = ["aria-label", "data-title", "name", "title"].some((attribute) => {
    const value = before.getAttribute(attribute)?.trim();
    return Boolean(value && value === after.getAttribute(attribute)?.trim());
  });
  const hasEvidence = exactText
    || headingMatches
    || accessibleIdentity
    || similarity >= .46
    || (distinctiveClasses.length > 0 && similarity >= .2)
    || (distinctiveClasses.length > 0 && !beforeText && !afterText);
  if (!hasEvidence) return Number.NEGATIVE_INFINITY;

  if (exactText) score += 220;
  if (headingMatches) score += 130;
  if (accessibleIdentity) score += 120;
  score += Math.round(similarity * 100);
  score += Math.min(48, distinctiveClasses.length * 16);
  score += Math.max(0, 16 - Math.abs(beforeIndex - afterIndex) * 3);
  return score;
}

function elementPairScore(
  before: Element,
  after: Element,
  beforeIndex: number,
  afterIndex: number,
): number {
  if (before.tagName !== after.tagName) return Number.NEGATIVE_INFINITY;
  const beforeKey = pairKey(before);
  const afterKey = pairKey(after);
  if (beforeKey || afterKey) {
    return beforeKey && beforeKey === afterKey
      ? 1_000 - Math.abs(beforeIndex - afterIndex)
      : Number.NEGATIVE_INFINITY;
  }
  if (normalizedMarkup(before) === normalizedMarkup(after)) {
    return 800 - Math.abs(beforeIndex - afterIndex);
  }
  const beforeText = normalizedText(before);
  const afterText = normalizedText(after);
  const exactText = Boolean(beforeText && beforeText === afterText);
  const similarity = reviewTextSimilarity(beforeText, afterText);
  const beforeClasses = new Set(classTokens(before));
  const sharedClasses = classTokens(after).filter((token) => beforeClasses.has(token));
  const distinctiveClasses = sharedClasses.filter((token) => ![
    "active", "card", "col", "column", "container", "content", "grid", "item",
    "main", "panel", "row", "section", "selected", "wrap", "wrapper",
  ].includes(token));
  const sameIdentityAttribute = ["aria-label", "name", "title", "alt"].some((attribute) => {
    const value = before.getAttribute(attribute)?.trim();
    return Boolean(value && value === after.getAttribute(attribute)?.trim());
  });
  const hasEvidence = exactText
    || sameIdentityAttribute
    || similarity >= .52
    || (distinctiveClasses.length > 0 && similarity >= .24)
    || (distinctiveClasses.length > 0 && !beforeText && !afterText);
  if (!hasEvidence) return Number.NEGATIVE_INFINITY;
  return (exactText ? 260 : 0)
    + (sameIdentityAttribute ? 180 : 0)
    + Math.round(similarity * 100)
    + Math.min(60, distinctiveClasses.length * 20)
    + Math.max(0, 16 - Math.abs(beforeIndex - afterIndex) * 2);
}

type SectionPair = {
  before: Element | null;
  after: Element | null;
  beforeIndex: number;
  afterIndex: number;
  moved?: boolean;
};

function markMovedPairs(pairs: SectionPair[]): SectionPair[] {
  const matched = pairs.filter((pair) => pair.before && pair.after);
  const beforeOrder = [...matched].sort((left, right) => left.beforeIndex - right.beforeIndex);
  const afterOrder = [...matched].sort((left, right) => left.afterIndex - right.afterIndex);
  const afterRank = new Map(afterOrder.map((pair, index) => [pair, index]));
  beforeOrder.forEach((pair, index) => {
    pair.moved = afterRank.get(pair) !== index;
  });
  return pairs;
}

function pairSections(before: Element[], after: Element[]): SectionPair[] {
  const assignments = new Map<Element, Element>();
  const usedAfter = new Set<Element>();
  const afterByKey = new Map<string, Element>();
  after.forEach((element) => {
    const key = pairKey(element);
    if (key && !afterByKey.has(key)) afterByKey.set(key, element);
  });

  before.forEach((beforeElement) => {
    const key = pairKey(beforeElement);
    const afterElement = key ? afterByKey.get(key) || null : null;
    if (!afterElement || usedAfter.has(afterElement)) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });

  const edges = before.flatMap((beforeElement, beforeIndex) => (
    assignments.has(beforeElement) || pairKey(beforeElement)
      ? []
      : after.map((afterElement, afterIndex) => ({
        beforeElement,
        afterElement,
        score: pairKey(afterElement)
          ? Number.NEGATIVE_INFINITY
          : sectionPairScore(beforeElement, afterElement, beforeIndex, afterIndex),
      }))
  )).filter((edge) => Number.isFinite(edge.score))
    .sort((left, right) => right.score - left.score);
  edges.forEach(({ beforeElement, afterElement }) => {
    if (assignments.has(beforeElement) || usedAfter.has(afterElement)) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });

  const pairs: SectionPair[] = before.map((beforeElement, index) => {
    const afterElement = assignments.get(beforeElement) || null;
    return {
      before: beforeElement,
      after: afterElement,
      beforeIndex: index,
      afterIndex: afterElement ? after.indexOf(afterElement) : -1,
    };
  });
  after.forEach((afterElement, index) => {
    if (!usedAfter.has(afterElement)) {
      pairs.push({ before: null, after: afterElement, beforeIndex: -1, afterIndex: index });
    }
  });
  return markMovedPairs(pairs);
}

type ReviewRuntimeSectionContext = {
  pair: SectionPair;
  outlineId: string;
  changeId?: string;
  label: string;
  panelKey?: string;
  panelPath: string[];
};

type ReviewRuntimeHostPair = {
  before: Element;
  after: Element;
};

type ReviewScriptDescriptor = {
  content: string;
  signature: string;
};

type ChangedReviewScript = {
  content: string;
};

function isRuntimeVisualPlaceholder(element: Element): boolean {
  if (!element.matches(RUNTIME_VISUAL_HOST_SELECTOR)) return false;
  return [...element.childNodes].every((node) => (
    node.nodeType === Node.COMMENT_NODE
    || (node.nodeType === Node.TEXT_NODE && !(node.textContent || "").trim())
  ));
}

function runtimeVisualIdentityParts(element: Element): string[] {
  const parts: string[] = [];
  if (element.id) parts.push(`id:${element.id}`);
  for (const attributeName of ["aria-label", "name", "title"]) {
    const value = element.getAttribute(attributeName)?.trim();
    if (value) parts.push(`${attributeName}:${value}`);
  }
  [...element.attributes].forEach((attribute) => {
    if (
      !attribute.name.startsWith("data-")
      || attribute.name.startsWith("data-pageroot-")
      || !/(?:canvas|chart|graph|plot|table|visual|viz)/iu.test(attribute.name)
    ) return;
    parts.push(`${attribute.name}:${attribute.value.trim()}`);
  });
  const distinctiveClasses = classTokens(element).filter((token) => (
    token.length >= 4 && !GENERIC_RUNTIME_VISUAL_CLASSES.has(token.toLowerCase())
  ));
  if (distinctiveClasses.length) {
    parts.push(`class:${distinctiveClasses.sort().join(".")}`);
  }
  return parts;
}

function runtimeVisualPairIdentity(element: Element): string | null {
  const explicitKey = pairKey(element);
  if (explicitKey) return `${element.tagName}:${explicitKey}`;
  const parts = runtimeVisualIdentityParts(element);
  return parts.length ? `${element.tagName}:${parts.join("|")}` : null;
}

function runtimeVisualSourceSignature(element: Element): string {
  const attributes = [...element.attributes]
    .filter((attribute) => !attribute.name.startsWith("data-pageroot-"))
    .map((attribute) => `${attribute.name}=${attribute.value}`)
    .sort();
  return `${element.tagName}|${attributes.join("|")}`;
}

function runtimeVisualSourceBoxSignature(element: Element): string {
  return JSON.stringify(REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES.map((attribute) => (
    [attribute, element.getAttribute(attribute)]
  )));
}

function relativeElementPath(root: Element, element: Element): string | null {
  const indexes: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    indexes.unshift([...parent.children].indexOf(current));
    current = parent;
  }
  return current === root ? indexes.join(".") : null;
}

function runtimeVisualHosts(root: Element): Element[] {
  return [root, ...root.querySelectorAll(RUNTIME_VISUAL_HOST_SELECTOR)]
    .filter(isRuntimeVisualPlaceholder);
}

function pairRuntimeVisualHosts(
  beforeRoot: Element,
  afterRoot: Element,
): ReviewRuntimeHostPair[] {
  const beforeHosts = runtimeVisualHosts(beforeRoot);
  const afterHosts = runtimeVisualHosts(afterRoot);
  const beforeIdentityCounts = new Map<string, number>();
  const afterByIdentity = new Map<string, Element[]>();
  beforeHosts.forEach((element) => {
    const identity = runtimeVisualPairIdentity(element);
    if (identity) beforeIdentityCounts.set(identity, (beforeIdentityCounts.get(identity) || 0) + 1);
  });
  afterHosts.forEach((element) => {
    const identity = runtimeVisualPairIdentity(element);
    if (!identity) return;
    const matches = afterByIdentity.get(identity) || [];
    matches.push(element);
    afterByIdentity.set(identity, matches);
  });

  const usedAfter = new Set<Element>();
  const assignments = new Map<Element, Element>();
  beforeHosts.forEach((beforeHost) => {
    const identity = runtimeVisualPairIdentity(beforeHost);
    const matches = identity ? afterByIdentity.get(identity) || [] : [];
    if (
      !identity
      || beforeIdentityCounts.get(identity) !== 1
      || matches.length !== 1
      || usedAfter.has(matches[0])
    ) return;
    assignments.set(beforeHost, matches[0]);
    usedAfter.add(matches[0]);
  });

  const afterByPath = new Map(afterHosts.flatMap((afterHost) => {
    const path = relativeElementPath(afterRoot, afterHost);
    return path === null ? [] : [[path, afterHost] as const];
  }));
  beforeHosts.forEach((beforeHost) => {
    if (assignments.has(beforeHost)) return;
    const identityParts = runtimeVisualIdentityParts(beforeHost);
    const path = relativeElementPath(beforeRoot, beforeHost);
    const afterHost = path === null ? null : afterByPath.get(path) || null;
    if (
      !identityParts.length
      || !afterHost
      || usedAfter.has(afterHost)
      || beforeHost.tagName !== afterHost.tagName
      || runtimeVisualSourceSignature(beforeHost) !== runtimeVisualSourceSignature(afterHost)
    ) return;
    assignments.set(beforeHost, afterHost);
    usedAfter.add(afterHost);
  });
  return [...assignments].map(([before, after]) => ({ before, after }));
}

function reviewScriptDescriptors(document: Document): ReviewScriptDescriptor[] {
  return [...document.scripts].map((element) => {
    const content = [
      element.getAttribute("src") || "",
      element.getAttribute("type") || "",
      element.textContent || "",
    ].join("\n");
    return {
      content,
      signature: `${element.getAttribute("src") || ""}\u0000${element.getAttribute("type") || ""}\u0000${element.textContent || ""}`,
    };
  });
}

function changedReviewScripts(
  beforeScripts: ReviewScriptDescriptor[],
  afterScripts: ReviewScriptDescriptor[],
): ChangedReviewScript[] {
  const unmatched = (
    scripts: ReviewScriptDescriptor[],
    counterparts: ReviewScriptDescriptor[],
  ) => {
    const remainingSignatures = new Map<string, number>();
    counterparts.forEach(({ signature }) => {
      remainingSignatures.set(signature, (remainingSignatures.get(signature) || 0) + 1);
    });
    return scripts.filter(({ signature }) => {
      const remaining = remainingSignatures.get(signature) || 0;
      if (!remaining) return true;
      remainingSignatures.set(signature, remaining - 1);
      return false;
    });
  };
  return [
    ...unmatched(beforeScripts, afterScripts),
    ...unmatched(afterScripts, beforeScripts),
  ].map(({ content }) => ({ content }));
}

function runtimeVisualScriptTokens(before: Element, after: Element): string[] {
  const elementTokens = (element: Element) => {
    const explicitValues = [
      element.id,
      ...[...element.attributes]
        .filter((attribute) => (
          attribute.name.startsWith("data-")
          && !attribute.name.startsWith("data-pageroot-")
          && /(?:canvas|chart|graph|plot|table|visual|viz)/iu.test(attribute.name)
        ))
        .flatMap((attribute) => [attribute.name, attribute.value]),
    ].map((value) => value.trim()).filter((value) => value.length >= 3);
    if (explicitValues.length) return explicitValues;
    const semanticValues = ["aria-label", "name", "title"]
      .map((attributeName) => element.getAttribute(attributeName) || "")
      .map((value) => value.trim())
      .filter((value) => value.length >= 3);
    if (semanticValues.length) return semanticValues;
    return classTokens(element)
      .filter((token) => (
        !GENERIC_RUNTIME_VISUAL_CLASSES.has(token.toLowerCase())
      ))
      .filter((value) => value.length >= 3);
  };
  return [...new Set([...elementTokens(before), ...elementTokens(after)])];
}

function hasRuntimeVisualCause(
  hostPair: ReviewRuntimeHostPair,
  changedScripts: ChangedReviewScript[],
): boolean {
  const tokens = runtimeVisualScriptTokens(hostPair.before, hostPair.after);
  const referencesHost = (content: string) => tokens.some((token) => content.includes(token));
  return tokens.length > 0 && changedScripts.some(({ content }) => referencesHost(content));
}

function staticReviewMarkerCoversRuntimeHost(
  host: Element,
  sectionRoot: Element,
): boolean {
  let candidate: Element | null = host;
  while (candidate) {
    if (candidate.hasAttribute("data-pageroot-review-marker")) {
      const markerTypes = String(
        candidate.getAttribute("data-pageroot-review-marker-types") || "",
      ).split(/\s+/u);
      if (
        candidate === host
        || markerTypes.includes("structure")
        || (
          markerTypes.includes("style")
          && candidate.getAttribute("data-pageroot-review-style-scope") === "box"
        )
      ) return true;
    }
    if (candidate === sectionRoot) break;
    candidate = candidate.parentElement;
  }
  return false;
}

function annotateRuntimeVisualCandidates(
  beforeDocument: Document,
  afterDocument: Document,
  sections: ReviewRuntimeSectionContext[],
): ReviewRuntimeVisualCandidate[] {
  const beforeScripts = reviewScriptDescriptors(beforeDocument);
  const afterScripts = reviewScriptDescriptors(afterDocument);
  const changedScripts = changedReviewScripts(beforeScripts, afterScripts);
  if (!changedScripts.length) return [];
  const proposed: Array<{
    before: Element;
    after: Element;
    section: ReviewRuntimeSectionContext;
  }> = [];
  const usedBefore = new Set<Element>();
  const usedAfter = new Set<Element>();
  sections.forEach((section) => {
    if (!section.pair.before || !section.pair.after) return;
    pairRuntimeVisualHosts(section.pair.before, section.pair.after).forEach((hostPair) => {
      if (
        usedBefore.has(hostPair.before)
        || usedAfter.has(hostPair.after)
        || staticReviewMarkerCoversRuntimeHost(hostPair.before, section.pair.before as Element)
        || staticReviewMarkerCoversRuntimeHost(hostPair.after, section.pair.after as Element)
        || !hasRuntimeVisualCause(hostPair, changedScripts)
      ) return;
      usedBefore.add(hostPair.before);
      usedAfter.add(hostPair.after);
      proposed.push({ ...hostPair, section });
    });
  });
  if (proposed.length > MAX_REVIEW_RUNTIME_VISUAL_CANDIDATES) return [];
  return proposed.map(({ before, after, section }, index) => {
    const key = `runtime-host-${index + 1}`;
    const changeId = section.changeId || `runtime-change-${section.outlineId}`;
    before.setAttribute(REVIEW_RUNTIME_VISUAL_HOST_ATTRIBUTE, key);
    after.setAttribute(REVIEW_RUNTIME_VISUAL_HOST_ATTRIBUTE, key);
    before.setAttribute(
      REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTE,
      runtimeVisualSourceBoxSignature(before),
    );
    after.setAttribute(
      REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTE,
      runtimeVisualSourceBoxSignature(after),
    );
    return {
      key,
      outlineId: section.outlineId,
      changeId,
      label: section.label,
      ...(section.panelKey ? { panelKey: section.panelKey } : {}),
      ...(section.panelPath.length ? { panelPath: [...section.panelPath] } : {}),
    };
  });
}

function helperText(
  types: ReviewChangeType[],
  beforePresent: boolean,
  afterPresent: boolean,
  pair?: SectionPair,
): string {
  if (!beforePresent) return "新增内容";
  if (!afterPresent) return "删除内容";
  if (pair?.moved && types.length === 1 && types[0] === "structure") return "位置调整";
  const labels = types.map((type) => (
    type === "text" ? "文本" : type === "structure" ? "结构" : "视觉"
  ));
  return `${[...new Set(labels)].join("、")}调整`;
}

function panelControlLabel(document: Document, panel: Element): string {
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

function regionGroupLabel(element: Element | null, document: Document): string {
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

type TextRange = { start: number; end: number };

type ReviewTextFootprintGroup = {
  id: string;
  ranges: TextRange[];
  scope: "inline" | "block";
  density: number;
  summary?: string;
};

function markTextFootprintOwner(
  anchor: Element,
  groups: ReviewTextFootprintGroup[],
) {
  const attribute = "data-pageroot-review-text-block-groups";
  const groupIds = new Set(
    (anchor.getAttribute(attribute) || "").split(/\s+/).filter(Boolean),
  );
  groups.forEach((group) => groupIds.add(group.id));
  anchor.setAttribute(attribute, [...groupIds].join(" "));
}

function applyTextFootprintMetadata(
  marker: HTMLElement,
  group: ReviewTextFootprintGroup,
) {
  marker.dataset.pagerootReviewTextGroup = group.id;
  marker.dataset.pagerootReviewTextScope = group.scope;
  marker.dataset.pagerootReviewTextDensity = String(
    Math.round(group.density * 10_000) / 10_000,
  );
  if (group.summary) marker.dataset.pagerootReviewTextSummary = group.summary;
}

function wrapTextRanges(
  inventory: ReviewTextInventory,
  groups: ReviewTextFootprintGroup[],
  tone: "removed" | "added",
  changeKind: "added" | "removed" | "before" | "after" = tone,
) {
  if (!groups.length) return;
  const annotatedRanges = groups.flatMap((group) => (
    mergeReviewTextRanges(group.ranges).map((range) => ({ ...range, group }))
  )).sort((left, right) => left.start - right.start || left.end - right.end);
  inventory.nodes.forEach(({ node, start, end }) => {
    const intersections = annotatedRanges
      .map((range) => ({
        start: Math.max(start, range.start),
        end: Math.min(end, range.end),
        group: range.group,
      }))
      .filter((range) => range.end > range.start);
    if (!intersections.length) return;
    const source = node.textContent || "";
    const fragment = node.ownerDocument.createDocumentFragment();
    const appendDifference = (value: string, group: ReviewTextFootprintGroup) => {
      if (!value) return;
      const marker = node.ownerDocument.createElement("span");
      marker.dataset.pagerootReviewText = tone;
      marker.dataset.pagerootReviewTextChange = changeKind;
      applyTextFootprintMetadata(marker, group);
      marker.textContent = value;
      fragment.append(marker);
    };
    let cursor = 0;
    intersections.forEach((range) => {
      const localStart = range.start - start;
      const localEnd = range.end - start;
      if (localStart > cursor) {
        fragment.append(source.slice(cursor, localStart));
      }
      appendDifference(source.slice(localStart, localEnd), range.group);
      cursor = localEnd;
    });
    if (cursor < source.length) {
      fragment.append(source.slice(cursor));
    }
    node.replaceWith(fragment);
  });
}

function wrapTextContext(
  inventory: ReviewTextInventory,
  tone: "removed" | "added",
  changeKind: "before" | "after",
  group: ReviewTextFootprintGroup,
) {
  inventory.nodes.forEach(({ node }) => {
    const value = node.textContent || "";
    if (!value.trim()) return;
    const marker = node.ownerDocument.createElement("span");
    marker.dataset.pagerootReviewTextContext = tone;
    marker.dataset.pagerootReviewTextChange = changeKind;
    applyTextFootprintMetadata(marker, group);
    marker.textContent = value;
    node.replaceWith(marker);
  });
}

const REVIEW_TEXT_BLOCK_TAGS = new Set([
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

type ReviewTextBlock = {
  anchor: Element;
  inventory: ReviewTextInventory;
};

function isReviewTextBlockElement(element: Element): boolean {
  return element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && REVIEW_TEXT_BLOCK_TAGS.has(element.tagName);
}

function sliceReviewTextInventory(
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
      })),
    breakOffsets: inventory.breakOffsets
      .filter((offset) => offset > start && offset < end)
      .map((offset) => offset - start),
  };
}

function semanticTextInventories(sourceNodes: Node[]): ReviewTextInventory[] {
  const inventory = reviewTextInventoryForNodes(sourceNodes);
  if (!inventory.text.trim()) return [];
  const boundaries = [...new Set(inventory.breakOffsets)]
    .filter((offset) => /[\u3002\uff01\uff1f!?\uff1b;]\s*$/u.test(inventory.text.slice(0, offset)))
    .filter((offset) => offset > 0 && offset < inventory.text.length);
  const ranges: TextRange[] = [];
  let start = 0;
  boundaries.forEach((end) => {
    if (inventory.text.slice(start, end).trim()) ranges.push({ start, end });
    start = end;
  });
  if (inventory.text.slice(start).trim()) ranges.push({ start, end: inventory.text.length });
  return ranges.map((range) => sliceReviewTextInventory(inventory, range.start, range.end));
}

function flowEndsAtHardBoundary(nodes: Node[]): boolean {
  const inventory = reviewTextInventoryForNodes(nodes);
  if (/[\u3002\uff01\uff1f!?\uff1b;]\s*$/u.test(inventory.text)) return true;
  const meaningfulElements = nodes.filter((node) => (
    node instanceof Element && node.tagName !== "BR" && normalizedText(node).length > 0
  ));
  const directCopy = nodes.some((node) => (
    node.nodeType === Node.TEXT_NODE && Boolean((node.textContent || "").trim())
  ));
  return meaningfulElements.length === 1 && !directCopy;
}

function reviewTextBlocks(region: Element): ReviewTextBlock[] {
  const blocks: ReviewTextBlock[] = [];
  const collect = (container: Element) => {
    let flow: Node[] = [];
    const flush = () => {
      if (!flow.length) return;
      semanticTextInventories(flow).forEach((inventory) => {
        blocks.push({ anchor: container, inventory });
      });
      flow = [];
    };
    container.childNodes.forEach((node) => {
      if (node instanceof Element && NON_CONTENT_TAGS.has(node.tagName)) return;
      if (node instanceof Element && isReviewTextBlockElement(node)) {
        flush();
        collect(node);
        return;
      }
      flow.push(node);
      if (node instanceof Element && node.tagName === "BR" && flowEndsAtHardBoundary(flow)) {
        flush();
      }
    });
    flush();
  };
  collect(region);
  if (!blocks.length) {
    const inventory = reviewTextInventory(region);
    if (inventory.text.trim()) blocks.push({ anchor: region, inventory });
  }
  return blocks;
}

function textBlockPairScore(
  before: ReviewTextBlock,
  after: ReviewTextBlock,
  beforeIndex: number,
  afterIndex: number,
): number {
  if (before.anchor.tagName !== after.anchor.tagName) return Number.NEGATIVE_INFINITY;
  const beforeKey = pairKey(before.anchor);
  const afterKey = pairKey(after.anchor);
  if ((beforeKey || afterKey) && beforeKey !== afterKey) return Number.NEGATIVE_INFINITY;
  const beforeText = before.inventory.text.replace(/\s+/g, " ").trim();
  const afterText = after.inventory.text.replace(/\s+/g, " ").trim();
  const exactText = beforeText === afterText;
  const similarity = reviewTextSimilarity(beforeText, afterText);
  const beforeClasses = new Set(classTokens(before.anchor));
  const sharedClasses = classTokens(after.anchor).filter((token) => beforeClasses.has(token));
  const distinctiveClasses = sharedClasses.filter((token) => ![
    "active", "card", "col", "column", "container", "content", "grid", "item",
    "main", "panel", "row", "section", "selected", "wrap", "wrapper",
  ].includes(token));
  if (!exactText && similarity < .48 && !(distinctiveClasses.length && similarity >= .24)) {
    return Number.NEGATIVE_INFINITY;
  }
  return (beforeKey ? 600 : 0)
    + (exactText ? 420 : 0)
    + Math.round(similarity * 160)
    + Math.min(80, distinctiveClasses.length * 24)
    + Math.max(0, 24 - Math.abs(beforeIndex - afterIndex) * 2);
}

function pairTextBlocks(
  before: ReviewTextBlock[],
  after: ReviewTextBlock[],
): Array<{ before: ReviewTextBlock | null; after: ReviewTextBlock | null }> {
  const assignments = new Map<ReviewTextBlock, ReviewTextBlock>();
  const usedAfter = new Set<ReviewTextBlock>();
  const edges = before.flatMap((beforeBlock, beforeIndex) => after.map((afterBlock, afterIndex) => ({
    beforeBlock,
    afterBlock,
    score: textBlockPairScore(beforeBlock, afterBlock, beforeIndex, afterIndex),
  }))).filter((edge) => Number.isFinite(edge.score))
    .sort((left, right) => right.score - left.score);
  edges.forEach(({ beforeBlock, afterBlock }) => {
    if (assignments.has(beforeBlock) || usedAfter.has(afterBlock)) return;
    assignments.set(beforeBlock, afterBlock);
    usedAfter.add(afterBlock);
  });

  const pairs: Array<{ before: ReviewTextBlock | null; after: ReviewTextBlock | null }> = before.map((beforeBlock) => ({
    before: beforeBlock,
    after: assignments.get(beforeBlock) || null,
  }));
  after.forEach((afterBlock) => {
    if (!usedAfter.has(afterBlock)) pairs.push({ before: null, after: afterBlock });
  });
  return pairs;
}

function markAllText(
  block: ReviewTextBlock,
  tone: "removed" | "added",
  groupId: string,
): boolean {
  const { inventory } = block;
  if (!inventory.text.trim()) return false;
  const group: ReviewTextFootprintGroup = {
    id: groupId,
    ranges: [{ start: 0, end: inventory.text.length }],
    scope: "block",
    density: 1,
  };
  markTextFootprintOwner(block.anchor, [group]);
  wrapTextRanges(inventory, [group], tone);
  return true;
}

function sameBreakLayout(before: ReviewTextInventory, after: ReviewTextInventory): boolean {
  return before.breakOffsets.length === after.breakOffsets.length
    && before.breakOffsets.every((offset, index) => offset === after.breakOffsets[index]);
}

function markTextDifferences(before: Element | null, after: Element | null): boolean {
  let changed = false;
  if (!before && after) {
    reviewTextBlocks(after).forEach((element, index) => {
      changed = markAllText(element, "added", `text-${index + 1}-1`) || changed;
    });
    return changed;
  }
  if (before && !after) {
    reviewTextBlocks(before).forEach((element, index) => {
      changed = markAllText(element, "removed", `text-${index + 1}-1`) || changed;
    });
    return changed;
  }
  if (!before || !after) return false;
  pairTextBlocks(reviewTextBlocks(before), reviewTextBlocks(after)).forEach((pair, pairIndex) => {
    const groupBase = `text-${pairIndex + 1}`;
    if (!pair.before && pair.after) {
      changed = markAllText(pair.after, "added", `${groupBase}-1`) || changed;
      return;
    }
    if (pair.before && !pair.after) {
      changed = markAllText(pair.before, "removed", `${groupBase}-1`) || changed;
      return;
    }
    if (!pair.before || !pair.after) return;
    const beforeInventory = pair.before.inventory;
    const afterInventory = pair.after.inventory;
    const layoutChanged = !sameBreakLayout(beforeInventory, afterInventory);
    if (beforeInventory.text === afterInventory.text) {
      if (!layoutChanged) return;
      const group: ReviewTextFootprintGroup = {
        id: `${groupBase}-1`,
        ranges: [{ start: 0, end: beforeInventory.text.length }],
        scope: "block",
        density: 1,
      };
      markTextFootprintOwner(pair.before.anchor, [group]);
      markTextFootprintOwner(pair.after.anchor, [group]);
      wrapTextContext(beforeInventory, "removed", "before", group);
      wrapTextContext(afterInventory, "added", "after", group);
      changed = true;
      return;
    }
    const differences = sentenceAwareTextDifferences(
      beforeInventory.text,
      afterInventory.text,
    );
    if (!differences.before.length && !differences.after.length && !layoutChanged) return;
    const plan = readableReviewTextFootprintPlan(
      beforeInventory.text,
      afterInventory.text,
      differences,
    );
    const preferredSummary = plan.scope === "block"
      && differences.before.length
      && differences.after.length
      ? "段落改写"
      : undefined;
    const beforeGroups: ReviewTextFootprintGroup[] = plan.before.groups.map((ranges, index) => ({
      id: `${groupBase}-${index + 1}`,
      ranges,
      scope: plan.scope,
      density: plan.density,
      summary: preferredSummary,
    }));
    const afterGroups: ReviewTextFootprintGroup[] = plan.after.groups.map((ranges, index) => ({
      id: `${groupBase}-${index + 1}`,
      ranges,
      scope: plan.scope,
      density: plan.density,
      summary: preferredSummary,
    }));
    if (differences.before.length) {
      markTextFootprintOwner(pair.before.anchor, beforeGroups);
      wrapTextRanges(
        beforeInventory,
        beforeGroups,
        "removed",
        differences.after.length ? "before" : "removed",
      );
      changed = true;
    } else {
      const contextGroup: ReviewTextFootprintGroup = {
        id: `${groupBase}-1`,
        ranges: [{ start: 0, end: beforeInventory.text.length }],
        scope: plan.scope,
        density: plan.density,
      };
      markTextFootprintOwner(pair.before.anchor, [contextGroup]);
      wrapTextContext(beforeInventory, "removed", "before", contextGroup);
      changed = true;
    }
    if (differences.after.length) {
      markTextFootprintOwner(pair.after.anchor, afterGroups);
      wrapTextRanges(
        afterInventory,
        afterGroups,
        "added",
        differences.before.length ? "after" : "added",
      );
      changed = true;
    } else {
      const contextGroup: ReviewTextFootprintGroup = {
        id: `${groupBase}-1`,
        ranges: [{ start: 0, end: afterInventory.text.length }],
        scope: plan.scope,
        density: plan.density,
      };
      markTextFootprintOwner(pair.after.anchor, [contextGroup]);
      wrapTextContext(afterInventory, "added", "after", contextGroup);
      changed = true;
    }
  });
  return changed;
}

function selfPresentationSignature(element: Element): string {
  return elementVisualSignature(element);
}

function visualPairKey(element: Element): string | null {
  const explicitKey = pairKey(element);
  if (explicitKey) return `${element.tagName}:${explicitKey}`;
  for (const attribute of ["name", "aria-label", "alt", "title"]) {
    const value = element.getAttribute(attribute)?.trim();
    if (value) return `${element.tagName}:${attribute}:${value}`;
  }
  const text = element.childElementCount <= 3
    ? (element.textContent || "").replace(/\s+/g, " ").trim()
    : "";
  if (text && text.length <= 80) return `${element.tagName}:text:${text}`;
  return null;
}

function pairVisualElements(
  beforeRoot: Element,
  afterRoot: Element,
): Array<{ before: Element; after: Element }> {
  const beforeElements = [beforeRoot, ...beforeRoot.querySelectorAll("*")].slice(0, 501);
  const afterElements = [afterRoot, ...afterRoot.querySelectorAll("*")].slice(0, 501);
  const afterBuckets = new Map<string, Element[]>();
  afterElements.forEach((element) => {
    const key = visualPairKey(element);
    if (!key) return;
    const bucket = afterBuckets.get(key) || [];
    bucket.push(element);
    afterBuckets.set(key, bucket);
  });
  const usedAfter = new Set<Element>();
  const assignments = new Map<Element, Element>();
  beforeElements.forEach((beforeElement) => {
    const key = visualPairKey(beforeElement);
    const keyed = key && afterBuckets.get(key)?.length === 1
      ? afterBuckets.get(key)?.[0] || null
      : null;
    if (!keyed || usedAfter.has(keyed)) return;
    assignments.set(beforeElement, keyed);
    usedAfter.add(keyed);
  });
  const edges = beforeElements.flatMap((beforeElement, beforeIndex) => (
    assignments.has(beforeElement)
      ? []
      : afterElements.map((afterElement, afterIndex) => ({
        beforeElement,
        afterElement,
        score: usedAfter.has(afterElement)
          ? Number.NEGATIVE_INFINITY
          : elementPairScore(beforeElement, afterElement, beforeIndex, afterIndex),
      }))
  )).filter((edge) => Number.isFinite(edge.score))
    .sort((left, right) => right.score - left.score);
  edges.forEach(({ beforeElement, afterElement }) => {
    if (assignments.has(beforeElement) || usedAfter.has(afterElement)) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });
  return [...assignments].map(([beforeElement, afterElement]) => ({
    before: beforeElement,
    after: afterElement,
  }));
}

function semanticElementName(element: Element): string {
  if (hasClassRole(element, ["card", "tile"])) return "卡片";
  if (element.matches("figure, svg, canvas")) return "图表";
  if (element.matches("img, picture")) return "图片";
  if (element.matches("li")) return "列表项";
  if (element.matches("table")) return "表格";
  if (element.matches("section, article")) return "区块";
  if (element.matches("h1, h2, h3, h4, h5, h6, p")) return "文本段";
  return "元素";
}

type StructureDifferenceStats = {
  added: string[];
  removed: string[];
  moved: string[];
  replaced: string[];
};

function structuralSelfSignature(element: Element): string {
  return [element.tagName.toLowerCase(), ...[...element.attributes]
    .filter((attribute) => (
      !VISUAL_ATTRIBUTE_NAMES.has(attribute.name.toLowerCase())
      && !attribute.name.startsWith("data-pageroot-review-")
      && attribute.name !== "data-pageroot-outline-id"
    ))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => `${attribute.name}=${attribute.value}`)]
    .join("|");
}

const STRUCTURE_TRANSPARENT_TAGS = new Set([
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BR",
  "CITE",
  "CODE",
  "DATA",
  "EM",
  "I",
  "KBD",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
]);

function structuralChildren(element: Element): Element[] {
  return eligibleChildren(element).flatMap((child) => (
    STRUCTURE_TRANSPARENT_TAGS.has(child.tagName)
      ? structuralChildren(child)
      : [child]
  ));
}

function markStructureElement(element: Element, tone: string) {
  element.setAttribute("data-pageroot-review-structure", tone);
}

function pairSiblingElements(before: Element[], after: Element[]): Map<Element, Element> {
  const assignments = new Map<Element, Element>();
  const usedAfter = new Set<Element>();
  const edges = before.flatMap((beforeElement, beforeIndex) => after.map((afterElement, afterIndex) => ({
    beforeElement,
    afterElement,
    score: elementPairScore(beforeElement, afterElement, beforeIndex, afterIndex),
  }))).filter((edge) => Number.isFinite(edge.score))
    .sort((left, right) => right.score - left.score);
  edges.forEach(({ beforeElement, afterElement }) => {
    if (assignments.has(beforeElement) || usedAfter.has(afterElement)) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });
  return assignments;
}

function markStructureDifferences(pair: SectionPair): boolean {
  const stats: StructureDifferenceStats = { added: [], removed: [], moved: [], replaced: [] };
  if (!pair.before && pair.after) {
    markStructureElement(pair.after, "added");
    stats.added.push(semanticElementName(pair.after));
  } else if (pair.before && !pair.after) {
    markStructureElement(pair.before, "removed");
    stats.removed.push(semanticElementName(pair.before));
  } else if (pair.before && pair.after) {
    if (pair.moved) {
      markStructureElement(pair.before, "from");
      markStructureElement(pair.after, "to");
      stats.moved.push(semanticElementName(pair.after));
    }
    let inspected = 0;
    const compareChildren = (beforeParent: Element, afterParent: Element, depth: number) => {
      if (depth > 8 || inspected >= 500) return;
      inspected += 1;
      if (structuralSelfSignature(beforeParent) !== structuralSelfSignature(afterParent)) {
        markStructureElement(beforeParent, "before");
        markStructureElement(afterParent, "after");
        stats.replaced.push(semanticElementName(afterParent));
      }
      const beforeChildren = structuralChildren(beforeParent);
      const afterChildren = structuralChildren(afterParent);
      const assignments = pairSiblingElements(beforeChildren, afterChildren);
      const usedAfter = new Set(assignments.values());
      const matchedBeforeOrder = beforeChildren.filter((element) => assignments.has(element));
      const matchedAfterOrder = [...matchedBeforeOrder].sort((left, right) => (
        afterChildren.indexOf(assignments.get(left) as Element)
        - afterChildren.indexOf(assignments.get(right) as Element)
      ));
      const afterRank = new Map(matchedAfterOrder.map((element, index) => [element, index]));
      beforeChildren.forEach((element) => {
        const match = assignments.get(element);
        if (!match) {
          markStructureElement(element, "removed");
          stats.removed.push(semanticElementName(element));
          return;
        }
        const matchedIndex = matchedBeforeOrder.indexOf(element);
        if (matchedIndex !== afterRank.get(element)) {
          markStructureElement(element, "from");
          markStructureElement(match, "to");
          stats.moved.push(semanticElementName(match));
        }
        compareChildren(element, match, depth + 1);
      });
      afterChildren.forEach((element) => {
        if (usedAfter.has(element)) return;
        markStructureElement(element, "added");
        stats.added.push(semanticElementName(element));
      });
    };
    compareChildren(pair.before, pair.after, 0);
  }
  return Object.values(stats).some((entries) => entries.length > 0);
}

function styleDeclarationMap(value: string): Map<string, string> {
  const declarations = new Map<string, string>();
  value.split(";").forEach((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator <= 0) return;
    declarations.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      normalizedCss(declaration.slice(separator + 1)),
    );
  });
  return declarations;
}

function stylesheetRules(document: Document): Map<string, string> {
  const rules = new Map<string, string>();
  document.querySelectorAll("style").forEach((styleElement) => {
    const css = styleElement.textContent || "";
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selector = normalizedCss(match[1]);
      if (!selector || selector.startsWith("@")) continue;
      rules.set(selector, normalizedCss(match[2]));
    }
  });
  return rules;
}

function changedStylesheetSelectors(before: Document, after: Document) {
  const beforeRules = stylesheetRules(before);
  const afterRules = stylesheetRules(after);
  return [...new Set([...beforeRules.keys(), ...afterRules.keys()])]
    .filter((selector) => beforeRules.get(selector) !== afterRules.get(selector))
    .map((selector) => ({
      selector,
      labels: [...new Set([
        ...styleDeclarationMap(beforeRules.get(selector) || "").keys(),
        ...styleDeclarationMap(afterRules.get(selector) || "").keys(),
      ])].filter((property) => (
        styleDeclarationMap(beforeRules.get(selector) || "").get(property)
        !== styleDeclarationMap(afterRules.get(selector) || "").get(property)
      )),
    }));
}

type ReviewStyleScope = "box" | "content";

const BOX_OWNED_STYLE_PROPERTIES = new Set([
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

const BOX_OWNED_STYLE_PREFIXES = [
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

function stylePropertyOwnsElementBox(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("--") || normalized.startsWith("@")) return true;
  return BOX_OWNED_STYLE_PROPERTIES.has(normalized)
    || BOX_OWNED_STYLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function styleScopeForProperties(properties: string[]): ReviewStyleScope {
  return properties.some(stylePropertyOwnsElementBox) ? "box" : "content";
}

function changedVisualProperties(before: Element, after: Element): string[] {
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

function elementsMatchingSelector(root: Element, rawSelector: string): Element[] {
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

function markStyleDifferences(before: Element | null, after: Element | null): boolean {
  if (!before || !after) return false;
  let marked = 0;
  let ownerSequence = before.ownerDocument.querySelectorAll(
    "[data-pageroot-review-style-owner]",
  ).length;
  const markPair = (
    beforeElement: Element,
    afterElement: Element,
    scope: ReviewStyleScope,
  ) => {
    const owner = beforeElement.getAttribute("data-pageroot-review-style-owner")
      || afterElement.getAttribute("data-pageroot-review-style-owner")
      || `style-owner-${++ownerSequence}`;
    const existingScope = beforeElement.getAttribute("data-pageroot-review-style-scope")
      || afterElement.getAttribute("data-pageroot-review-style-scope");
    const resolvedScope: ReviewStyleScope = existingScope === "box" || scope === "box"
      ? "box"
      : "content";
    beforeElement.setAttribute("data-pageroot-review-style", "before");
    afterElement.setAttribute("data-pageroot-review-style", "after");
    beforeElement.setAttribute("data-pageroot-review-style-owner", owner);
    afterElement.setAttribute("data-pageroot-review-style-owner", owner);
    beforeElement.setAttribute("data-pageroot-review-style-scope", resolvedScope);
    afterElement.setAttribute("data-pageroot-review-style-scope", resolvedScope);
    marked += 1;
  };
  for (const pair of pairVisualElements(before, after)) {
    if (selfPresentationSignature(pair.before) === selfPresentationSignature(pair.after)) continue;
    markPair(
      pair.before,
      pair.after,
      styleScopeForProperties(changedVisualProperties(pair.before, pair.after)),
    );
    if (marked >= 40) break;
  }
  const changedRules = changedStylesheetSelectors(before.ownerDocument, after.ownerDocument);
  changedRules.forEach(({ selector, labels }) => {
    const scope = styleScopeForProperties(labels);
    selector.split(",").forEach((part) => {
      const beforeMatches = elementsMatchingSelector(before, part).slice(0, 40);
      const afterMatches = elementsMatchingSelector(after, part).slice(0, 40);
      pairSiblingElements(beforeMatches, afterMatches).forEach((afterElement, beforeElement) => {
        markPair(beforeElement, afterElement, scope);
      });
    });
  });
  return marked > 0;
}

function annotateChangePair(
  pair: SectionPair,
): ReviewChangeType[] {
  const structureChanged = markStructureDifferences(pair);
  const styleChanged = markStyleDifferences(pair.before, pair.after);
  const textChanged = markTextDifferences(pair.before, pair.after);
  return [
    ...(textChanged ? ["text" as const] : []),
    ...(structureChanged ? ["structure" as const] : []),
    ...(styleChanged ? ["style" as const] : []),
  ];
}

function attachChangeMarkerMetadata(
  pair: SectionPair,
  changeId: string,
  helper: string,
) {
  const pairTextKinds = new Set(
    [pair.before, pair.after].flatMap((root) => (
      root
        ? [root, ...root.querySelectorAll("[data-pageroot-review-text-change]")]
          .map((element) => element.getAttribute("data-pageroot-review-text-change"))
          .filter(Boolean)
        : []
    )),
  );
  const pairedTextReplacement = pairTextKinds.has("added")
    && pairTextKinds.has("removed");
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    const markerElements = [root, ...root.querySelectorAll("*")].filter((element) => (
      element.hasAttribute("data-pageroot-review-text")
      || element.hasAttribute("data-pageroot-review-text-context")
      || element.hasAttribute("data-pageroot-review-structure")
      || element.hasAttribute("data-pageroot-review-style")
    ));
    markerElements.forEach((element, index) => {
      const markerTypes: ReviewChangeType[] = [];
      const textMarker = element.hasAttribute("data-pageroot-review-text")
        || element.hasAttribute("data-pageroot-review-text-context");
      if (textMarker) markerTypes.push("text");
      if (element.hasAttribute("data-pageroot-review-structure")) markerTypes.push("structure");
      if (element.hasAttribute("data-pageroot-review-style")) markerTypes.push("style");
      const textChange = element.getAttribute("data-pageroot-review-text-change");
      const structuralAddition = Boolean(
        element.closest('[data-pageroot-review-structure="added"]'),
      );
      const structuralRemoval = Boolean(
        element.closest('[data-pageroot-review-structure="removed"]'),
      );
      const readableTextSummary = element.getAttribute(
        "data-pageroot-review-text-summary",
      );
      const summary = textMarker
        ? readableTextSummary
          || (textChange === "added" && (!pairedTextReplacement || structuralAddition)
            ? "新增内容"
            : textChange === "removed" && (!pairedTextReplacement || structuralRemoval)
              ? "删除内容"
              : "文本调整")
        : helper;
      element.setAttribute("data-pageroot-review-marker", changeId);
      element.setAttribute("data-pageroot-review-marker-types", markerTypes.join(" "));
      element.setAttribute("data-pageroot-review-summary", summary);
      element.setAttribute("data-pageroot-review-active", "false");
      if (index === 0) element.setAttribute("data-pageroot-review-primary", "true");
    });
  });
}

function resolvedCommentElement(
  document: Document,
  sourceIndex: ReturnType<typeof buildSourceIndex>,
  sourceElementsByNodeId: ReadonlyMap<string, Element>,
  target: HtmlCanvasSelection,
): Element | null {
  if (target.selector.trim().toLowerCase() === "body" && target.level === "module") {
    return document.body;
  }
  const sourceElement = resolveReviewCommentSourceElement(sourceIndex, target);
  if (sourceElement) {
    const sourceMappedElement = sourceElementsByNodeId.get(sourceElement.nodeId);
    if (sourceMappedElement) return sourceMappedElement;
    if (sourceElement.selector) {
      try {
        const matches = document.querySelectorAll(sourceElement.selector);
        if (matches.length === 1) return matches[0];
      } catch {
        // Fall through to the frozen selector below.
      }
    }
  }
  // The frozen target remains authoritative; a selector fallback is allowed
  // only when it resolves uniquely in that same immutable source document.
  try {
    const matches = target.selector ? document.querySelectorAll(target.selector) : [];
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function annotateReviewComments(
  document: Document,
  sourceHtml: string,
  comments: readonly CommentItem[],
  indexedSource?: ReturnType<typeof buildSourceIndex> | null,
): ReviewCommentGroup[] {
  if (!comments.length || !document.body) return [];
  let sourceIndex = indexedSource ?? null;
  try {
    sourceIndex ??= buildSourceIndex(sourceHtml);
  } catch {
    return [];
  }
  const sourceElementsByNodeId = new Map<string, Element>();
  document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    const nodeId = element.getAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    if (nodeId && !sourceElementsByNodeId.has(nodeId)) {
      sourceElementsByNodeId.set(nodeId, element);
    }
  });
  const groups = new Map<Element, CommentItem[]>();
  comments.forEach((comment) => {
    if (!comment.text.trim() && !comment.attachments?.length) return;
    const element = resolvedCommentElement(
      document,
      sourceIndex,
      sourceElementsByNodeId,
      comment.target,
    );
    if (!element) return;
    const existing = groups.get(element);
    if (existing) existing.push(comment);
    else groups.set(element, [comment]);
  });
  if (!groups.size) return [];

  return [...groups.entries()].map(([element, items], index) => {
    const key = `review-comment-${index + 1}`;
    element.setAttribute("data-pageroot-review-comment-key", key);
    if (element === document.body) {
      element.setAttribute("data-pageroot-review-comment-global", "true");
    }
    return {
      key,
      items: items.map((comment) => ({
        text: comment.text.trim()
          || `已添加 ${comment.attachments?.length || 0} 个参考附件`,
        attachmentCount: comment.attachments?.length || 0,
      })),
    };
  });
}

function clearReservedReviewMarkup(
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

function doctypeString(doctype: DocumentType | null): string {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

function baseHrefFromSourcePath(sourcePath?: string): string | undefined {
  const trimmedPath = sourcePath?.trim();
  if (!trimmedPath) return undefined;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      const sourceUrl = new URL(trimmedPath);
      if (!sourceUrl.pathname.endsWith("/")) {
        sourceUrl.pathname = sourceUrl.pathname.slice(0, sourceUrl.pathname.lastIndexOf("/") + 1);
      }
      sourceUrl.search = "";
      sourceUrl.hash = "";
      return sourceUrl.href;
    }
  } catch {
    return undefined;
  }
  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("/")) return undefined;
  const directoryPath = normalizedPath.endsWith("/")
    ? normalizedPath
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
  return `file://${directoryPath.split("/").map(encodeURIComponent).join("/")}`;
}

function reviewBootstrap(
  sessionId: string,
  side: ReviewSide,
  runtimeVisualCandidateKeys: readonly string[] = [],
): string {
  return String.raw`
(() => {
  const sessionId = ${JSON.stringify(sessionId)};
  const side = ${JSON.stringify(side)};
  // This first managed script binds evidence readers before authored scripts execute.
  const runtimeVisualExpectedKeys = Object.freeze(
    ${JSON.stringify([...runtimeVisualCandidateKeys])},
  );
  const runtimeVisualBindCall = (method) => Function.prototype.call.bind(method);
  const runtimeVisualFunctionHasInstance = runtimeVisualBindCall(
    Function.prototype[Symbol.hasInstance],
  );
  const RuntimeVisualElement = Element;
  const RuntimeVisualCanvasElement = HTMLCanvasElement;
  const RuntimeVisualSvgElement = SVGElement;
  const RuntimeVisualMap = Map;
  const RuntimeVisualSet = Set;
  const RuntimeVisualWeakMap = WeakMap;
  const RuntimeVisualString = String;
  const runtimeVisualArrayPush = runtimeVisualBindCall(Array.prototype.push);
  const runtimeVisualArrayForEach = runtimeVisualBindCall(Array.prototype.forEach);
  const runtimeVisualArrayJoin = runtimeVisualBindCall(Array.prototype.join);
  const runtimeVisualArrayIncludes = runtimeVisualBindCall(Array.prototype.includes);
  const runtimeVisualArrayMap = runtimeVisualBindCall(Array.prototype.map);
  const runtimeVisualArraySome = runtimeVisualBindCall(Array.prototype.some);
  const runtimeVisualArrayIsArray = Array.isArray.bind(Array);
  const runtimeVisualStringCharCodeAt = runtimeVisualBindCall(
    String.prototype.charCodeAt,
  );
  const runtimeVisualStringFromCharCode = String.fromCharCode.bind(String);
  const runtimeVisualNumberToString = runtimeVisualBindCall(Number.prototype.toString);
  const runtimeVisualStringPadStart = runtimeVisualBindCall(String.prototype.padStart);
  const runtimeVisualDocumentQuerySelectorAll = runtimeVisualBindCall(
    Document.prototype.querySelectorAll,
  );
  const runtimeVisualDocumentCreateTreeWalker = runtimeVisualBindCall(
    Document.prototype.createTreeWalker,
  );
  const runtimeVisualDocumentCreateRange = runtimeVisualBindCall(
    Document.prototype.createRange,
  );
  const runtimeVisualElementGetAttribute = runtimeVisualBindCall(
    Element.prototype.getAttribute,
  );
  const runtimeVisualElementSetAttribute = runtimeVisualBindCall(
    Element.prototype.setAttribute,
  );
  const runtimeVisualElementRemoveAttribute = runtimeVisualBindCall(
    Element.prototype.removeAttribute,
  );
  const runtimeVisualElementMatches = runtimeVisualBindCall(Element.prototype.matches);
  const runtimeVisualElementClosest = runtimeVisualBindCall(Element.prototype.closest);
  const runtimeVisualElementQuerySelector = runtimeVisualBindCall(
    Element.prototype.querySelector,
  );
  const runtimeVisualElementGetBoundingClientRect = runtimeVisualBindCall(
    Element.prototype.getBoundingClientRect,
  );
  const runtimeVisualNodeParentElement = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "parentElement").get,
  );
  const runtimeVisualNodeTextContent = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "textContent").get,
  );
  const runtimeVisualElementTagName = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get,
  );
  const runtimeVisualNodeListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(NodeList.prototype, "length").get,
  );
  const runtimeVisualNodeListItem = runtimeVisualBindCall(NodeList.prototype.item);
  const runtimeVisualTreeWalkerNextNode = runtimeVisualBindCall(TreeWalker.prototype.nextNode);
  const RuntimeVisualMutationObserver = MutationObserver;
  const runtimeVisualMutationObserverObserve = runtimeVisualBindCall(
    MutationObserver.prototype.observe,
  );
  const runtimeVisualMutationObserverTakeRecords = runtimeVisualBindCall(
    MutationObserver.prototype.takeRecords,
  );
  const runtimeVisualMutationRecordType = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "type").get,
  );
  const runtimeVisualMutationRecordTarget = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "target").get,
  );
  const runtimeVisualMutationRecordAddedNodes = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "addedNodes").get,
  );
  const runtimeVisualMutationRecordOldValue = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "oldValue").get,
  );
  const runtimeVisualRangeSelectNodeContents = runtimeVisualBindCall(
    Range.prototype.selectNodeContents,
  );
  const runtimeVisualRangeGetClientRects = runtimeVisualBindCall(Range.prototype.getClientRects);
  const runtimeVisualRangeDetach = runtimeVisualBindCall(Range.prototype.detach);
  const runtimeVisualDomRectListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(DOMRectList.prototype, "length").get,
  );
  const runtimeVisualDomRectListItem = runtimeVisualBindCall(DOMRectList.prototype.item);
  const runtimeVisualCanvasGetContext = runtimeVisualBindCall(
    HTMLCanvasElement.prototype.getContext,
  );
  const runtimeVisualCanvasToDataUrl = runtimeVisualBindCall(
    HTMLCanvasElement.prototype.toDataURL,
  );
  const runtimeVisualCanvasWidth = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width").get,
  );
  const runtimeVisualCanvasHeight = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height").get,
  );
  const runtimeVisualContextGetImageData = runtimeVisualBindCall(
    CanvasRenderingContext2D.prototype.getImageData,
  );
  const runtimeVisualImageData = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(ImageData.prototype, "data").get,
  );
  const runtimeVisualStyleGetPropertyValue = runtimeVisualBindCall(
    CSSStyleDeclaration.prototype.getPropertyValue,
  );
  const runtimeVisualGetComputedStyle = getComputedStyle.bind(window);
  const runtimeVisualMapGet = runtimeVisualBindCall(Map.prototype.get);
  const runtimeVisualMapHas = runtimeVisualBindCall(Map.prototype.has);
  const runtimeVisualMapSet = runtimeVisualBindCall(Map.prototype.set);
  const runtimeVisualSetHas = runtimeVisualBindCall(Set.prototype.has);
  const runtimeVisualSetAdd = runtimeVisualBindCall(Set.prototype.add);
  const runtimeVisualWeakMapGet = runtimeVisualBindCall(WeakMap.prototype.get);
  const runtimeVisualWeakMapHas = runtimeVisualBindCall(WeakMap.prototype.has);
  const runtimeVisualWeakMapSet = runtimeVisualBindCall(WeakMap.prototype.set);
  const runtimeVisualStringify = JSON.stringify.bind(JSON);
  const runtimeVisualExpectedKeySet = new RuntimeVisualSet(runtimeVisualExpectedKeys);
  const runtimeVisualIsInstance = (constructor, value) => (
    runtimeVisualFunctionHasInstance(constructor, value)
  );
  const runtimeVisualStyleValue = (style, property) => (
    runtimeVisualStyleGetPropertyValue(style, property)
  );
  const runtimeVisualWhitespaceCode = (code) => (
    code === 0x0009
    || (code >= 0x000a && code <= 0x000d)
    || code === 0x0020
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff
  );
  const runtimeVisualNormalizeText = (value) => {
    const source = RuntimeVisualString(value || "");
    const values = [];
    let pendingWhitespace = false;
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      if (runtimeVisualWhitespaceCode(code)) {
        if (values.length) pendingWhitespace = true;
        continue;
      }
      if (pendingWhitespace) runtimeVisualArrayPush(values, " ");
      runtimeVisualArrayPush(values, runtimeVisualStringFromCharCode(code));
      pendingWhitespace = false;
    }
    return runtimeVisualArrayJoin(values, "");
  };
  const runtimeVisualQueryElements = (selector) => {
    const list = runtimeVisualDocumentQuerySelectorAll(document, selector);
    const values = [];
    const length = runtimeVisualNodeListLength(list);
    for (let index = 0; index < length; index += 1) {
      const value = runtimeVisualNodeListItem(list, index);
      if (value) runtimeVisualArrayPush(values, value);
    }
    return values;
  };
  let overlayFrame = 0;
  let layoutReportFrame = 0;
  let layoutReportTimer = 0;
  let presentationReadyTimer = 0;
  let geometryRevision = 0;
  let activeScrollCommand = null;
  let followerGestureId = 0;
  let acceptsFollowerScroll = false;
  let projectionEpoch = 0;
  let projectionTransitioning = false;
  let initialProjectionCommitted = false;
  let mirroringPanel = false;
  let mirroringAction = false;
  let currentState = { filter: "all", focus: "all", transparency: 18, scale: 1 };
  const postToParent = parent.postMessage.bind(parent);
  const runtimeVisualChannel = typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  const postRuntimeVisualPort = runtimeVisualChannel
    ? runtimeVisualChannel.port1.postMessage.bind(runtimeVisualChannel.port1)
    : null;
  const stopImmediateMessagePropagation = Function.prototype.call.bind(
    Event.prototype.stopImmediatePropagation,
  );
  let runtimeVisualChannelTransferred = false;
  let runtimeVisualSnapshotBatch = null;
  const post = (type, extra = {}) => postToParent({
    source: "pageroot-ai-review",
    sessionId,
    side,
    type,
    ...extra,
  }, "*");
  const publishRuntimeVisualSnapshots = () => {
    if (
      !runtimeVisualChannelTransferred
      || !postRuntimeVisualPort
      || runtimeVisualSnapshotBatch === null
    ) return;
    postRuntimeVisualPort({
      source: "pageroot-ai-review-runtime-visual",
      sessionId,
      side,
      type: "runtime-visual-snapshots",
      runtimeVisualSnapshots: runtimeVisualSnapshotBatch,
    });
  };
  const transferRuntimeVisualChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (!/^[a-f0-9]{32}$/u.test(challenge)) return;
    if (!runtimeVisualChannel || runtimeVisualChannelTransferred) return;
    runtimeVisualChannelTransferred = true;
    postToParent({
      source: "pageroot-ai-review",
      sessionId,
      side,
      type: "runtime-visual-channel",
      challenge,
    }, "*", [runtimeVisualChannel.port2]);
    publishRuntimeVisualSnapshots();
    post("ready", {
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    });
  };
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const documentHeight = () => Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
  );
  const safeKey = (value) => String(value || "").replace(/[^a-z0-9-]/gi, "");
  const safePanelPath = (value) => [...new Set(
    (Array.isArray(value) ? value : String(value || "").split(/\s+/))
      .map(safeKey)
      .filter(Boolean),
  )];
  const runtimeVisualHostAttribute = ${JSON.stringify(REVIEW_RUNTIME_VISUAL_HOST_ATTRIBUTE)};
  const runtimeVisualSourceBoxAttribute = ${JSON.stringify(REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTE)};
  const runtimeVisualSourceBoxAttributes = ${JSON.stringify(REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES)};
  const runtimeVisualCandidateLimit = ${MAX_REVIEW_RUNTIME_VISUAL_CANDIDATES};
  const runtimeVisualAtomLimit = 4096;
  const runtimeVisualBatchAtomLimit = 8192;
  const runtimeVisualBatchNodeLimit = 8192;
  const runtimeVisualCanvasPixelLimit = 4194304;
  const runtimeVisualValueLimit = 200000;
  const runtimeVisualBatchValueLimit = 400000;
  const runtimeVisualClaimedHosts = new RuntimeVisualMap();
  let runtimeVisualHostClaimsValid = true;
  const runtimeVisualClaimHost = (host, key) => {
    if (
      !runtimeVisualIsInstance(RuntimeVisualElement, host)
      || !runtimeVisualSetHas(runtimeVisualExpectedKeySet, key)
    ) return;
    const claimed = runtimeVisualMapGet(runtimeVisualClaimedHosts, key);
    if (claimed && claimed !== host) {
      runtimeVisualHostClaimsValid = false;
      return;
    }
    runtimeVisualMapSet(runtimeVisualClaimedHosts, key, host);
  };
  const runtimeVisualProcessHostClaimRecords = (records) => {
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const record = records[recordIndex];
      const recordType = runtimeVisualMutationRecordType(record);
      if (recordType === "childList") {
        const addedNodes = runtimeVisualMutationRecordAddedNodes(record);
        const addedNodeCount = runtimeVisualNodeListLength(addedNodes);
        for (let nodeIndex = 0; nodeIndex < addedNodeCount; nodeIndex += 1) {
          const node = runtimeVisualNodeListItem(addedNodes, nodeIndex);
          if (!runtimeVisualIsInstance(RuntimeVisualElement, node)) continue;
          runtimeVisualClaimHost(
            node,
            runtimeVisualElementGetAttribute(node, runtimeVisualHostAttribute) || "",
          );
        }
        continue;
      }
      if (recordType !== "attributes") continue;
      const target = runtimeVisualMutationRecordTarget(record);
      runtimeVisualClaimHost(
        target,
        runtimeVisualMutationRecordOldValue(record) || "",
      );
      runtimeVisualClaimHost(
        target,
        runtimeVisualElementGetAttribute(target, runtimeVisualHostAttribute) || "",
      );
    }
  };
  const runtimeVisualHostClaimObserver = runtimeVisualExpectedKeys.length
    ? new RuntimeVisualMutationObserver(runtimeVisualProcessHostClaimRecords)
    : null;
  if (runtimeVisualHostClaimObserver) {
    runtimeVisualMutationObserverObserve(
      runtimeVisualHostClaimObserver,
      document.documentElement,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [runtimeVisualHostAttribute],
        attributeOldValue: true,
      },
    );
  }
  const runtimeVisualDrainHostClaims = () => {
    if (!runtimeVisualHostClaimObserver) return;
    runtimeVisualProcessHostClaimRecords(
      runtimeVisualMutationObserverTakeRecords(runtimeVisualHostClaimObserver),
    );
  };
  const runtimeVisualDelay = (milliseconds) => new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
  const runtimeVisualFrames = () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  const runtimeVisualHex = (value) => runtimeVisualStringPadStart(
    runtimeVisualNumberToString(value >>> 0, 16),
    8,
    "0",
  );
  const runtimeVisualDigest = (value) => {
    const textValue = RuntimeVisualString(value || "");
    let first = 2166136261;
    let second = 2246822507;
    let third = 3266489909;
    let fourth = 668265263;
    for (let index = 0; index < textValue.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(textValue, index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489917);
      third = Math.imul(third ^ code, 668265263);
      fourth = Math.imul(fourth ^ code, 374761393);
    }
    return runtimeVisualHex(first)
      + runtimeVisualHex(second)
      + runtimeVisualHex(third)
      + runtimeVisualHex(fourth)
      + ":" + Math.max(1, textValue.length);
  };
  const runtimeVisualByteDigest = (bytes) => {
    let first = 2166136261;
    let second = 2246822507;
    let third = 3266489909;
    let fourth = 668265263;
    for (let index = 0; index < bytes.length; index += 1) {
      const value = bytes[index];
      first = Math.imul(first ^ value, 16777619);
      second = Math.imul(second ^ value, 3266489917);
      third = Math.imul(third ^ value, 668265263);
      fourth = Math.imul(fourth ^ value, 374761393);
    }
    return runtimeVisualHex(first)
      + runtimeVisualHex(second)
      + runtimeVisualHex(third)
      + runtimeVisualHex(fourth)
      + ":" + Math.max(1, bytes.length);
  };
  const runtimeVisualRounded = (value) => Math.round(Number(value || 0) * 2) / 2;
  const runtimeVisualRect = (rect, hostRect) => [
    runtimeVisualRounded(rect.left - hostRect.left),
    runtimeVisualRounded(rect.top - hostRect.top),
    runtimeVisualRounded(rect.width),
    runtimeVisualRounded(rect.height),
  ];
  const runtimeVisualRectSignature = (rect, hostRect) => (
    runtimeVisualArrayJoin(runtimeVisualRect(rect, hostRect), ",")
  );
  const runtimeVisualVisible = (element, host, visibilityCache) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return false;
    let current = element;
    let visible = true;
    const uncached = [];
    while (runtimeVisualIsInstance(RuntimeVisualElement, current)) {
      if (runtimeVisualWeakMapHas(visibilityCache, current)) {
        visible = runtimeVisualWeakMapGet(visibilityCache, current);
        break;
      }
      runtimeVisualArrayPush(uncached, current);
      const style = runtimeVisualGetComputedStyle(current);
      if (
        runtimeVisualStyleValue(style, "display") === "none"
        || runtimeVisualStyleValue(style, "visibility") === "hidden"
        || runtimeVisualStyleValue(style, "visibility") === "collapse"
        || Number(runtimeVisualStyleValue(style, "opacity") || 1) <= 0
      ) {
        visible = false;
        break;
      }
      if (current === host) break;
      current = runtimeVisualNodeParentElement(current);
    }
    runtimeVisualArrayForEach(uncached, (item) => {
      runtimeVisualWeakMapSet(visibilityCache, item, visible);
    });
    const rect = runtimeVisualElementGetBoundingClientRect(element);
    return visible
      && rect.width > 0
      && rect.height > 0;
  };
  const runtimeVisualTransparent = (value) => (
    !value
    || value === "transparent"
    || value === "rgba(0, 0, 0, 0)"
    || value === "rgba(0,0,0,0)"
  );
  const runtimeVisualTextPaint = (style) => [
    runtimeVisualStyleValue(style, "color"),
    runtimeVisualStyleValue(style, "font-family"),
    runtimeVisualStyleValue(style, "font-size"),
    runtimeVisualStyleValue(style, "font-style"),
    runtimeVisualStyleValue(style, "font-weight"),
    runtimeVisualStyleValue(style, "line-height"),
    runtimeVisualStyleValue(style, "letter-spacing"),
    runtimeVisualStyleValue(style, "text-decoration-color"),
    runtimeVisualStyleValue(style, "text-decoration-line"),
    runtimeVisualStyleValue(style, "text-decoration-style"),
    runtimeVisualStyleValue(style, "text-shadow"),
  ];
  const runtimeVisualTextPaintSignature = (style) => (
    runtimeVisualArrayJoin(runtimeVisualTextPaint(style), "|")
  );
  const runtimeVisualBoxPaint = (style) => {
    const borderVisible = runtimeVisualArraySome(
      ["top", "right", "bottom", "left"],
      (sideName) => (
        parseFloat(
          runtimeVisualStyleValue(style, "border-" + sideName + "-width") || "0",
        ) > 0
        && runtimeVisualStyleValue(style, "border-" + sideName + "-style") !== "none"
        && !runtimeVisualTransparent(
          runtimeVisualStyleValue(style, "border-" + sideName + "-color"),
        )
      ),
    );
    const backgroundImage = runtimeVisualStyleValue(style, "background-image");
    const painted = !runtimeVisualTransparent(
      runtimeVisualStyleValue(style, "background-color"),
    )
      || Boolean(backgroundImage && backgroundImage !== "none")
      || borderVisible
      || Boolean(
        runtimeVisualStyleValue(style, "box-shadow")
        && runtimeVisualStyleValue(style, "box-shadow") !== "none"
      )
      || Boolean(
        runtimeVisualStyleValue(style, "filter")
        && runtimeVisualStyleValue(style, "filter") !== "none"
      )
      || Number(runtimeVisualStyleValue(style, "opacity") || 1) < 1;
    if (!painted) return "";
    return runtimeVisualArrayJoin([
      runtimeVisualStyleValue(style, "background-color"),
      backgroundImage,
      runtimeVisualStyleValue(style, "border-top-color"),
      runtimeVisualStyleValue(style, "border-top-style"),
      runtimeVisualStyleValue(style, "border-top-width"),
      runtimeVisualStyleValue(style, "border-right-color"),
      runtimeVisualStyleValue(style, "border-right-style"),
      runtimeVisualStyleValue(style, "border-right-width"),
      runtimeVisualStyleValue(style, "border-bottom-color"),
      runtimeVisualStyleValue(style, "border-bottom-style"),
      runtimeVisualStyleValue(style, "border-bottom-width"),
      runtimeVisualStyleValue(style, "border-left-color"),
      runtimeVisualStyleValue(style, "border-left-style"),
      runtimeVisualStyleValue(style, "border-left-width"),
      runtimeVisualStyleValue(style, "border-radius"),
      runtimeVisualStyleValue(style, "box-shadow"),
      runtimeVisualStyleValue(style, "filter"),
      runtimeVisualStyleValue(style, "opacity"),
    ], "|");
  };
  const runtimeVisualPush = (capture, channel, value) => {
    const normalized = RuntimeVisualString(value || "");
    capture.valueLength += normalized.length;
    capture.budget.atoms += 1;
    capture.budget.valueLength += normalized.length;
    if (
      capture[channel].length >= runtimeVisualAtomLimit
      || capture.valueLength > runtimeVisualValueLimit
      || capture.budget.atoms > runtimeVisualBatchAtomLimit
      || capture.budget.valueLength > runtimeVisualBatchValueLimit
    ) throw new Error("runtime-visual-budget");
    runtimeVisualArrayPush(capture[channel], normalized);
  };
  const runtimeVisualCanvas = (canvas, capture, displayRect, includeDisplaySize) => {
    const width = Math.max(0, Math.round(Number(runtimeVisualCanvasWidth(canvas) || 0)));
    const height = Math.max(0, Math.round(Number(runtimeVisualCanvasHeight(canvas) || 0)));
    const pixels = width * height;
    if (!pixels || pixels > runtimeVisualCanvasPixelLimit) {
      throw new Error("runtime-visual-canvas-size");
    }
    if (capture.budget.canvasPixels + pixels > runtimeVisualCanvasPixelLimit) {
      throw new Error("runtime-visual-canvas-batch");
    }
    capture.budget.canvasPixels += pixels;
    let value = "";
    const context = runtimeVisualCanvasGetContext(
      canvas,
      "2d",
      { willReadFrequently: true },
    );
    if (context) {
      value = runtimeVisualByteDigest(
        runtimeVisualImageData(
          runtimeVisualContextGetImageData(context, 0, 0, width, height),
        ),
      );
    } else {
      const dataUrl = runtimeVisualCanvasToDataUrl(canvas, "image/png");
      if (!dataUrl || dataUrl.length > 24000000) throw new Error("runtime-visual-canvas-data");
      value = runtimeVisualDigest(dataUrl);
    }
    capture.canvasPixels += pixels;
    if (capture.canvasPixels > runtimeVisualCanvasPixelLimit) {
      throw new Error("runtime-visual-canvas-total");
    }
    runtimeVisualPush(capture, "canvas", width + "x" + height
      + (includeDisplaySize
        ? "|display=" + runtimeVisualRounded(displayRect.width)
          + "x" + runtimeVisualRounded(displayRect.height)
        : "")
      + "|" + value);
  };
  const runtimeVisualVectorAttributes = [
    "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
    "r", "rx", "ry", "width", "height", "viewBox", "transform",
  ];
  const captureRuntimeVisualHost = (host, budget) => {
    try {
      if (!runtimeVisualIsInstance(RuntimeVisualElement, host)) return null;
      const hostRect = runtimeVisualElementGetBoundingClientRect(host);
      const sourceBoxSignature = runtimeVisualElementGetAttribute(
        host,
        runtimeVisualSourceBoxAttribute,
      );
      const currentBoxSignature = runtimeVisualStringify(runtimeVisualArrayMap(
        runtimeVisualSourceBoxAttributes,
        (attribute) => [attribute, runtimeVisualElementGetAttribute(host, attribute)],
      ));
      const hostBoxMutated = sourceBoxSignature !== null
        && sourceBoxSignature !== currentBoxSignature;
      const hostStyle = runtimeVisualGetComputedStyle(host);
      const hostFullyTransparent = runtimeVisualStyleValue(hostStyle, "display") !== "none"
        && runtimeVisualStyleValue(hostStyle, "visibility") !== "hidden"
        && runtimeVisualStyleValue(hostStyle, "visibility") !== "collapse"
        && Number(runtimeVisualStyleValue(hostStyle, "opacity") || 1) <= 0
        && hostRect.width > 0
        && hostRect.height > 0;
      const capture = {
        content: [],
        paint: [],
        geometry: [],
        vector: [],
        canvas: [],
        canvasPixels: 0,
        valueLength: 0,
        budget,
      };
      const runtimeVisualVisibilityCache = new RuntimeVisualWeakMap();
      const descendants = [host];
      let hostOwnPaint = false;
      budget.nodes += 1;
      if (!hostFullyTransparent && !runtimeVisualElementMatches(host, "canvas")) {
        const elementWalker = runtimeVisualDocumentCreateTreeWalker(
          document,
          host,
          NodeFilter.SHOW_ELEMENT,
        );
        let descendant = runtimeVisualTreeWalkerNextNode(elementWalker);
        while (descendant) {
          budget.nodes += 1;
          if (budget.nodes > runtimeVisualBatchNodeLimit) return null;
          if (!runtimeVisualElementClosest(descendant,
            "[data-pageroot-review-projection-layer], [data-pageroot-review-transition-mask]",
          )) runtimeVisualArrayPush(descendants, descendant);
          if (descendants.length > runtimeVisualAtomLimit) return null;
          descendant = runtimeVisualTreeWalkerNextNode(elementWalker);
        }
      }
      if (budget.nodes > runtimeVisualBatchNodeLimit) return null;
      runtimeVisualArrayForEach(descendants, (element) => {
        if (element === host && hostFullyTransparent) {
          hostOwnPaint = true;
          runtimeVisualPush(capture, "paint", "host-box|opacity=0");
          return;
        }
        if (runtimeVisualIsInstance(RuntimeVisualCanvasElement, element)) {
          if (!runtimeVisualVisible(
            element,
            host,
            runtimeVisualVisibilityCache,
          )) return;
          const canvasStyle = runtimeVisualGetComputedStyle(element);
          const canvasRect = runtimeVisualElementGetBoundingClientRect(element);
          runtimeVisualCanvas(element, capture, canvasRect, hostBoxMutated);
          const canvasPaint = runtimeVisualBoxPaint(canvasStyle);
          if (canvasPaint) {
            if (element === host) hostOwnPaint = true;
            runtimeVisualPush(capture, "paint", "host-box|" + canvasPaint
              + (hostBoxMutated
                ? "|size=" + runtimeVisualRounded(canvasRect.width)
                  + "x" + runtimeVisualRounded(canvasRect.height)
                : ""));
            if (hostBoxMutated) {
              runtimeVisualPush(
                capture,
                "geometry",
                "box|" + runtimeVisualRectSignature(canvasRect, hostRect),
              );
            }
          }
          return;
        }
        const style = runtimeVisualGetComputedStyle(element);
        const rect = runtimeVisualElementGetBoundingClientRect(element);
        const elementTagName = runtimeVisualElementTagName(element);
        const isVector = runtimeVisualIsInstance(RuntimeVisualSvgElement, element)
          && !runtimeVisualArrayIncludes(
            ["svg", "defs", "desc", "metadata", "title"],
            elementTagName.toLowerCase(),
          );
        if (isVector) {
          if (!runtimeVisualVisible(
            element,
            host,
            runtimeVisualVisibilityCache,
          )) return;
          const attributes = runtimeVisualArrayJoin(runtimeVisualArrayMap(
            runtimeVisualVectorAttributes,
            (name) => name + "=" + (runtimeVisualElementGetAttribute(element, name) || ""),
          ), "|");
          runtimeVisualPush(capture, "vector", runtimeVisualArrayJoin([
            elementTagName.toLowerCase(),
            attributes,
            runtimeVisualStyleValue(style, "fill"),
            runtimeVisualStyleValue(style, "fill-opacity"),
            runtimeVisualStyleValue(style, "stroke"),
            runtimeVisualStyleValue(style, "stroke-opacity"),
            runtimeVisualStyleValue(style, "stroke-width"),
            runtimeVisualStyleValue(style, "opacity"),
          ], "|"));
          runtimeVisualPush(
            capture,
            "geometry",
            "vector|" + runtimeVisualRectSignature(rect, hostRect),
          );
          return;
        }
        if (!runtimeVisualVisible(
          element,
          host,
          runtimeVisualVisibilityCache,
        )) return;
        if (runtimeVisualArrayIncludes(
          ["IMG", "PICTURE", "PROGRESS", "METER", "VIDEO"],
          elementTagName,
        )) {
          runtimeVisualPush(capture, "content", runtimeVisualArrayJoin([
            elementTagName,
            runtimeVisualElementGetAttribute(element, "src") || "",
            runtimeVisualElementGetAttribute(element, "srcset") || "",
            runtimeVisualElementGetAttribute(element, "value") || "",
            runtimeVisualElementGetAttribute(element, "max") || "",
          ], "|"));
          runtimeVisualPush(
            capture,
            "geometry",
            "media|" + runtimeVisualRectSignature(rect, hostRect),
          );
        }
        const boxPaint = runtimeVisualBoxPaint(style);
        if (boxPaint) {
          const ownsPaint = element === host;
          if (ownsPaint) hostOwnPaint = true;
          runtimeVisualPush(capture, "paint", (ownsPaint ? "host-box|" : "box|")
            + boxPaint
            + (ownsPaint && hostBoxMutated
              ? "|size=" + runtimeVisualRounded(rect.width)
                + "x" + runtimeVisualRounded(rect.height)
              : ""));
          if (!ownsPaint || hostBoxMutated) {
            runtimeVisualPush(
              capture,
              "geometry",
              "box|" + runtimeVisualRectSignature(rect, hostRect),
            );
          }
        }
      });

      const walker = runtimeVisualDocumentCreateTreeWalker(
        document,
        host,
        NodeFilter.SHOW_TEXT,
      );
      let textNode = runtimeVisualTreeWalkerNextNode(walker);
      let textNodes = 0;
      while (textNode && !hostFullyTransparent) {
        textNodes += 1;
        budget.nodes += 1;
        if (
          textNodes > runtimeVisualAtomLimit
          || budget.nodes > runtimeVisualBatchNodeLimit
        ) return null;
        const parentElement = runtimeVisualNodeParentElement(textNode);
        const text = runtimeVisualNormalizeText(
          runtimeVisualNodeTextContent(textNode) || "",
        );
        if (
          text
          && parentElement
          && !runtimeVisualElementClosest(
            parentElement,
            "script, style, noscript, template",
          )
          && runtimeVisualVisible(
            parentElement,
            host,
            runtimeVisualVisibilityCache,
          )
        ) {
          const range = runtimeVisualDocumentCreateRange(document);
          runtimeVisualRangeSelectNodeContents(range, textNode);
          const rawRects = runtimeVisualRangeGetClientRects(range);
          const rects = [];
          const rectCount = runtimeVisualDomRectListLength(rawRects);
          for (let rectIndex = 0; rectIndex < rectCount; rectIndex += 1) {
            const textRect = runtimeVisualDomRectListItem(rawRects, rectIndex);
            if (textRect && textRect.width > 0 && textRect.height > 0) {
              runtimeVisualArrayPush(rects, textRect);
            }
          }
          runtimeVisualRangeDetach(range);
          if (rects.length) {
            runtimeVisualPush(capture, "content", "text|" + text);
            runtimeVisualPush(
              capture,
              "paint",
              "text|" + runtimeVisualTextPaintSignature(
                runtimeVisualGetComputedStyle(parentElement),
              ),
            );
            runtimeVisualArrayForEach(rects, (rect) => runtimeVisualPush(
              capture,
              "geometry",
              "text|" + runtimeVisualRectSignature(rect, hostRect),
            ));
          }
        }
        textNode = runtimeVisualTreeWalkerNextNode(walker);
      }

      const specialRuntimeContent = runtimeVisualElementMatches(host, "canvas, svg, tbody")
        || Boolean(runtimeVisualElementQuerySelector(
          host,
          "canvas, svg, table, tbody, progress, meter",
        ));
      const chartLike = capture.canvasPixels > 0
        || capture.vector.length > 0
        || hostOwnPaint
        || (specialRuntimeContent && (
          capture.content.length + capture.paint.length + capture.geometry.length > 0
        ))
        || capture.paint.length >= 2
        || capture.content.length >= 2
        || (capture.paint.length >= 1 && capture.content.length >= 1);
      if (!chartLike) {
        return {
          key: runtimeVisualElementGetAttribute(host, runtimeVisualHostAttribute) || "",
          state: "empty",
          contentSignature: "",
          paintSignature: "",
          geometrySignature: "",
          vectorSignature: "",
          canvasSignature: "",
          contentAtoms: 0,
          paintAtoms: 0,
          geometryAtoms: 0,
          vectorAtoms: 0,
          canvasPixels: 0,
        };
      }
      const channelSignature = (values) => values.length
        ? runtimeVisualDigest(runtimeVisualArrayJoin(values, "\u001f"))
        : "";
      return {
        key: runtimeVisualElementGetAttribute(host, runtimeVisualHostAttribute) || "",
        state: "stable",
        contentSignature: channelSignature(capture.content),
        paintSignature: channelSignature(capture.paint),
        geometrySignature: channelSignature(capture.geometry),
        vectorSignature: channelSignature(capture.vector),
        canvasSignature: channelSignature(capture.canvas),
        contentAtoms: capture.content.length,
        paintAtoms: capture.paint.length,
        geometryAtoms: capture.geometry.length,
        vectorAtoms: capture.vector.length,
        canvasPixels: capture.canvasPixels,
      };
    } catch {
      return null;
    }
  };
  const runtimeVisualExpectedHosts = () => {
    if (runtimeVisualExpectedKeys.length > runtimeVisualCandidateLimit) return null;
    if (!runtimeVisualExpectedKeys.length) return [];
    runtimeVisualDrainHostClaims();
    if (!runtimeVisualHostClaimsValid) return null;
    const discovered = runtimeVisualQueryElements(
      "[" + runtimeVisualHostAttribute + "]",
    );
    const hostsByKey = new RuntimeVisualMap();
    let matchedHosts = 0;
    runtimeVisualArrayForEach(discovered, (host) => {
      const key = runtimeVisualElementGetAttribute(host, runtimeVisualHostAttribute) || "";
      if (!runtimeVisualSetHas(runtimeVisualExpectedKeySet, key)) return;
      if (runtimeVisualMapHas(hostsByKey, key)) {
        matchedHosts = runtimeVisualExpectedKeys.length + 1;
        return;
      }
      runtimeVisualMapSet(hostsByKey, key, host);
      matchedHosts += 1;
    });
    if (matchedHosts !== runtimeVisualExpectedKeys.length) return null;
    const orderedHosts = [];
    runtimeVisualArrayForEach(runtimeVisualExpectedKeys, (key) => {
      const host = runtimeVisualMapGet(hostsByKey, key);
      const claimedHost = runtimeVisualMapGet(runtimeVisualClaimedHosts, key);
      if (host && claimedHost === host) runtimeVisualArrayPush(orderedHosts, host);
    });
    return orderedHosts.length === runtimeVisualExpectedKeys.length
      ? orderedHosts
      : null;
  };
  const runtimeVisualHostsMatch = (expected, current) => {
    if (current === null || expected.length !== current.length) return false;
    for (let index = 0; index < expected.length; index += 1) {
      if (expected[index] !== current[index]) return false;
    }
    return true;
  };
  const collectRuntimeVisualSnapshots = async () => {
    const hosts = runtimeVisualExpectedHosts();
    if (hosts === null) return null;
    if (!hosts.length) return [];
    await Promise.race([
      document.fonts?.ready || Promise.resolve(),
      runtimeVisualDelay(120),
    ]).catch(() => {});
    await runtimeVisualDelay(24);
    await runtimeVisualFrames();
    if (!runtimeVisualHostsMatch(hosts, runtimeVisualExpectedHosts())) return null;
    const firstBudget = { atoms: 0, nodes: 0, valueLength: 0, canvasPixels: 0 };
    const first = new RuntimeVisualMap();
    for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
      const host = hosts[hostIndex];
      const expectedKey = runtimeVisualElementGetAttribute(
        host,
        runtimeVisualHostAttribute,
      ) || "";
      const snapshot = captureRuntimeVisualHost(host, firstBudget);
      if (!snapshot || snapshot.key !== expectedKey) return null;
      runtimeVisualMapSet(first, expectedKey, snapshot);
    }
    await runtimeVisualDelay(64);
    await runtimeVisualFrames();
    if (!runtimeVisualHostsMatch(hosts, runtimeVisualExpectedHosts())) return null;
    const secondBudget = { atoms: 0, nodes: 0, valueLength: 0, canvasPixels: 0 };
    const snapshots = [];
    for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
      const host = hosts[hostIndex];
      const key = runtimeVisualElementGetAttribute(host, runtimeVisualHostAttribute) || "";
      if (!runtimeVisualSetHas(runtimeVisualExpectedKeySet, key)) return null;
      const firstSnapshot = runtimeVisualMapGet(first, key);
      const secondSnapshot = captureRuntimeVisualHost(host, secondBudget);
      if (!firstSnapshot || !secondSnapshot || secondSnapshot.key !== key) return null;
      if (runtimeVisualStringify(firstSnapshot) === runtimeVisualStringify(secondSnapshot)) {
        runtimeVisualArrayPush(snapshots, secondSnapshot);
      }
    }
    return snapshots;
  };
  const applyRuntimeVisualChanges = (rawMarkers) => {
    runtimeVisualArrayForEach(runtimeVisualQueryElements(
      '[data-pageroot-review-runtime-marker="true"]',
    ), (element) => {
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-runtime-marker");
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-marker");
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-marker-types");
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-summary");
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-style-scope");
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-style-owner");
    });
    const hosts = runtimeVisualExpectedHosts();
    const hostsByKey = new RuntimeVisualMap();
    runtimeVisualArrayForEach(hosts || [], (host) => {
      runtimeVisualMapSet(
        hostsByKey,
        runtimeVisualElementGetAttribute(host, runtimeVisualHostAttribute) || "",
        host,
      );
    });
    const markers = hosts
      && runtimeVisualArrayIsArray(rawMarkers)
      && rawMarkers.length <= hosts.length
      ? rawMarkers
      : [];
    const normalized = [];
    const seen = new RuntimeVisualSet();
    for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
      const marker = markers[markerIndex];
      const key = safeKey(marker?.key);
      const changeId = safeKey(marker?.changeId);
      if (
        !key
        || !changeId
        || runtimeVisualSetHas(seen, key)
        || !runtimeVisualMapHas(hostsByKey, key)
      ) {
        normalized.length = 0;
        break;
      }
      runtimeVisualSetAdd(seen, key);
      runtimeVisualArrayPush(normalized, { key, changeId });
    }
    runtimeVisualArrayForEach(normalized, ({ key, changeId }) => {
      const host = runtimeVisualMapGet(hostsByKey, key);
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-runtime-marker", "true");
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-marker", changeId);
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-marker-types", "style");
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-summary", "视觉调整");
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-style-scope", "box");
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-style-owner", "runtime-" + key);
      runtimeVisualElementSetAttribute(host, "data-pageroot-review-active", "false");
    });
    initialProjectionCommitted = true;
    scheduleOverlayRender();
    scheduleLayoutReport(true);
  };
  const isSafePanelControl = (element) => element instanceof Element && element.matches(
    '[data-pageroot-review-panel-control="true"]',
  );
  const panelControlForKey = (panelKey) => [...document.querySelectorAll(
    '[data-pageroot-review-panel-control="true"][data-pageroot-review-panel-key]',
  )].find((candidate) => candidate.getAttribute("data-pageroot-review-panel-key") === panelKey) || null;
  const panelForKey = (panelKey) => [...document.querySelectorAll(
    '[data-pageroot-review-panel-container="true"][data-pageroot-review-panel-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-pageroot-review-panel-key") === panelKey
  )) || null;
  const actionForKey = (actionKey) => [...document.querySelectorAll(
    '[data-pageroot-review-action-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-pageroot-review-action-key") === actionKey
  )) || null;
  const scheduleOverlayRender = () => {
    if (projectionTransitioning || !initialProjectionCommitted) return;
    cancelAnimationFrame(overlayFrame);
    overlayFrame = requestAnimationFrame(renderReviewOverlays);
  };
  const reportReviewCommentLayouts = () => {
    if (projectionTransitioning) return;
    const commentLayouts = [...document.querySelectorAll('[data-pageroot-review-comment-key]')]
      .flatMap((target) => {
        const key = safeKey(target.getAttribute("data-pageroot-review-comment-key"));
        if (!key) return [];
        const rects = [...target.getClientRects()]
          .filter((rect) => rect.width > 0 && rect.height > 0);
        if (!rects.length) return [];
        const global = target.getAttribute("data-pageroot-review-comment-global") === "true";
        const firstRect = rects.reduce((current, rect) => (
          rect.top < current.top ? rect : current
        ));
        return [{
          key,
          left: global ? 22 : Math.max(...rects.map((rect) => rect.right)) + scrollX + 10,
          top: global ? 22 : firstRect.top + scrollY + firstRect.height / 2,
          viewportLeft: global ? 22 : Math.max(...rects.map((rect) => rect.right)) + 10,
          viewportTop: global ? 22 : firstRect.top + firstRect.height / 2,
          global,
        }];
      });
    post("comment-layout", { commentLayouts });
  };
  const reportScrollGeometry = () => {
    if (projectionTransitioning) return;
    geometryRevision += 1;
    const anchors = [...document.querySelectorAll("[data-pageroot-outline-id]")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const id = safeKey(element.getAttribute("data-pageroot-outline-id"));
        if (!id || rect.width <= 0 || rect.height <= 0) return [];
        return [{ id, top: Math.max(0, scrollY + rect.top), height: rect.height }];
      });
    post("scroll-geometry", {
      scrollGeometry: {
        viewportHeight: innerHeight,
        maximumScroll: Math.max(0, documentHeight() - innerHeight),
        revision: geometryRevision,
        anchors,
      },
    });
  };
  const reportLayoutMetrics = () => {
    layoutReportFrame = 0;
    if (projectionTransitioning) return;
    reportScrollGeometry();
    reportReviewCommentLayouts();
  };
  const scheduleLayoutReport = (immediate = false) => {
    if (projectionTransitioning) return;
    clearTimeout(layoutReportTimer);
    const queueReport = () => {
      cancelAnimationFrame(layoutReportFrame);
      layoutReportFrame = requestAnimationFrame(reportLayoutMetrics);
    };
    if (immediate) queueReport();
    else layoutReportTimer = window.setTimeout(queueReport, 80);
  };
  const renderTransitionMask = () => {
    document.querySelector('[data-pageroot-review-transition-mask]')?.remove();
    const mask = document.createElement("div");
    mask.setAttribute("data-pageroot-review-transition-mask", "true");
    mask.style.setProperty("width", Math.max(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ) + "px", "important");
    mask.style.setProperty("height", Math.max(innerHeight, documentHeight()) + "px", "important");
    const contextVisibility = clamp(Number(currentState.transparency ?? 18), 0, 100) / 100;
    mask.style.setProperty("opacity", String(Math.round((1 - contextVisibility) * 1000) / 1000), "important");
    document.body.append(mask);
  };
  const beginProjectionTransition = (rawEpoch) => {
    const requestedEpoch = Number(rawEpoch || 0);
    if (
      Number.isFinite(requestedEpoch)
      && requestedEpoch > 0
      && requestedEpoch < projectionEpoch
    ) return projectionEpoch;
    projectionEpoch = Number.isFinite(requestedEpoch) && requestedEpoch > 0
      ? requestedEpoch
      : projectionEpoch + 1;
    projectionTransitioning = true;
    clearTimeout(presentationReadyTimer);
    clearTimeout(layoutReportTimer);
    cancelAnimationFrame(overlayFrame);
    cancelAnimationFrame(layoutReportFrame);
    document.querySelector('[data-pageroot-review-projection-layer]')?.remove();
    document.documentElement.dataset.pagerootReviewTransitioning = "true";
    renderTransitionMask();
    post("comment-layout", { commentLayouts: [] });
    return projectionEpoch;
  };
  const schedulePresentationReady = (rawEpoch) => {
    const epoch = Number(rawEpoch || projectionEpoch);
    if (!projectionTransitioning || epoch !== projectionEpoch) return;
    clearTimeout(presentationReadyTimer);
    presentationReadyTimer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!projectionTransitioning || epoch !== projectionEpoch) return;
        post("presentation-ready", { presentationEpoch: epoch });
      }));
    }, 80);
  };
  const commitProjectionTransition = (rawEpoch) => {
    const epoch = Number(rawEpoch || 0);
    if (epoch && epoch !== projectionEpoch) return;
    clearTimeout(presentationReadyTimer);
    projectionTransitioning = false;
    document.documentElement.removeAttribute("data-pageroot-review-transitioning");
    document.querySelector('[data-pageroot-review-transition-mask]')?.remove();
    renderReviewOverlays();
    scheduleLayoutReport(true);
  };
  const applyPanelGroupState = (panelKey) => {
    const panel = panelForKey(panelKey);
    const groupKey = panel?.getAttribute("data-pageroot-review-panel-group") || "";
    if (!groupKey) return;
    const members = [...document.querySelectorAll(
      '[data-pageroot-review-panel-group="' + groupKey + '"]',
    )];
    const stateClasses = [...new Set(members.flatMap((member) => String(
      member.getAttribute("data-pageroot-review-panel-active-classes") || "",
    ).split(/\s+/).filter(Boolean)))];
    members.forEach((candidate) => {
      const active = candidate.getAttribute("data-pageroot-review-panel-key") === panelKey;
      stateClasses.forEach((className) => candidate.classList.toggle(className, active));
      if (isSafePanelControl(candidate)) {
        candidate.setAttribute("aria-selected", active ? "true" : "false");
        candidate.setAttribute("aria-expanded", active ? "true" : "false");
        if (candidate.hasAttribute("tabindex") || candidate.getAttribute("role") === "tab") {
          candidate.tabIndex = active ? 0 : -1;
        }
      } else if (candidate.getAttribute("data-pageroot-review-panel-container") === "true") {
        candidate.toggleAttribute("hidden", !active);
        candidate.setAttribute("aria-hidden", active ? "false" : "true");
      }
    });
  };
  const activatePanelKey = (rawPanelKey) => {
    const panelKey = safeKey(rawPanelKey);
    if (!panelKey) return;
    const control = panelControlForKey(panelKey);
    const panel = panelForKey(panelKey);
    const alreadyPresented = panel instanceof HTMLElement
      && !panel.hidden
      && panel.getAttribute("aria-hidden") !== "true"
      && getComputedStyle(panel).display !== "none"
      && getComputedStyle(panel).visibility !== "hidden"
      && panel.getClientRects().length > 0;
    if (control instanceof HTMLElement && !alreadyPresented) {
      mirroringPanel = true;
      control.click();
      queueMicrotask(() => { mirroringPanel = false; });
    }
    applyPanelGroupState(panelKey);
  };
  const activatePanelPath = (rawPath) => {
    const panelPath = safePanelPath(rawPath);
    panelPath.forEach(activatePanelKey);
    return panelPath;
  };
  const mirrorAction = (message) => {
    const actionKey = safeKey(message.actionKey);
    if (!actionKey) return;
    let action = actionForKey(actionKey);
    const actionActivatesRequestedPanel = action
      && isSafePanelControl(action)
      && action.getAttribute("data-pageroot-review-panel-key") === safeKey(message.panelKey);
    if (message.panelPath?.length) activatePanelPath(message.panelPath);
    else if (message.panelKey && !actionActivatesRequestedPanel) activatePanelKey(message.panelKey);
    action = actionForKey(actionKey);
    if (!(action instanceof HTMLElement) || action.matches(":disabled")) {
      post("action-applied", { actionKey, applied: false });
      return;
    }
    mirroringAction = true;
    try {
      if (message.actionType === "control-state") {
        if (action instanceof HTMLInputElement) {
          if (typeof message.checked === "boolean") action.checked = message.checked;
          if (typeof message.value === "string") action.value = message.value;
        } else if (action instanceof HTMLSelectElement || action instanceof HTMLTextAreaElement) {
          if (typeof message.value === "string") action.value = message.value;
        }
        action.dispatchEvent(new Event("input", { bubbles: true }));
        action.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        action.click();
      }
    } finally {
      queueMicrotask(() => {
        mirroringAction = false;
        scheduleOverlayRender();
        requestAnimationFrame(() => post("action-applied", { actionKey, applied: true }));
      });
    }
  };
  const matchingPanelControl = (panel) => {
    const panelKey = panel.getAttribute("data-pageroot-review-panel-key") || "";
    if (panelKey) return panelControlForKey(panelKey);
    const panelId = panel.id
      || panel.getAttribute("data-page")
      || panel.getAttribute("data-tab-panel")
      || "";
    if (!panelId) return null;
    return [...document.querySelectorAll('[data-pageroot-review-panel-control="true"]')]
      .find((candidate) => (
        candidate.getAttribute("aria-controls") === panelId
        || candidate.getAttribute("data-p") === panelId
        || candidate.getAttribute("data-tab") === panelId
        || (panelId.startsWith("p") && candidate.getAttribute("data-p") === panelId.slice(1))
      )) || null;
  };
  const revealTarget = (target, requestedPanelPath) => {
    if (requestedPanelPath?.length) activatePanelPath(requestedPanelPath);
    else if (typeof requestedPanelPath === "string") activatePanelKey(requestedPanelPath);
    if (!target) return;
    const details = target.closest("details");
    if (details) details.open = true;
    const ancestors = [];
    let candidate = target;
    while (candidate && candidate !== document.body) {
      if (
        candidate.hasAttribute("data-pageroot-review-panel-key")
        || candidate.hasAttribute("hidden")
        || candidate.getAttribute("aria-hidden") === "true"
        || candidate.getAttribute("role") === "tabpanel"
        || candidate.hasAttribute("data-tab-panel")
      ) ancestors.unshift(candidate);
      candidate = candidate.parentElement;
    }
    ancestors.forEach((panel) => {
      const panelKey = panel.getAttribute("data-pageroot-review-panel-key") || "";
      if (panelKey) activatePanelKey(panelKey);
      const control = matchingPanelControl(panel);
      if (!panelKey && control instanceof HTMLElement) {
        mirroringPanel = true;
        control.click();
        queueMicrotask(() => { mirroringPanel = false; });
      }
      if (panel.hasAttribute("hidden")) panel.removeAttribute("hidden");
      if (panel.getAttribute("aria-hidden") === "true") panel.setAttribute("aria-hidden", "false");
      if (control) {
        control.setAttribute("aria-selected", "true");
        control.setAttribute("aria-expanded", "true");
      }
    });
  };
  const focusTarget = (target, panelPath) => {
    revealTarget(target, panelPath);
    if (!target) return;
    requestAnimationFrame(() => {
      const token = "focus-" + Date.now() + "-" + Math.random();
      target.scrollIntoView({ block: "start", behavior: "auto" });
      activeScrollCommand = { commandId: token, top: scrollY, left: scrollX };
    });
  };
  const applyScrollOwner = (message) => {
    const gestureId = Math.max(0, Math.trunc(Number(message.gestureId || 0)));
    const leader = message.leader === "before" || message.leader === "after"
      ? message.leader
      : "";
    acceptsFollowerScroll = message.linked === true && Boolean(leader) && leader !== side;
    followerGestureId = acceptsFollowerScroll ? gestureId : 0;
    if (!acceptsFollowerScroll) activeScrollCommand = null;
  };
  const applyScrollPosition = (message) => {
    const gestureId = Math.max(0, Math.trunc(Number(message.gestureId || 0)));
    const force = message.force === true;
    if (!force && (!acceptsFollowerScroll || gestureId !== followerGestureId)) return;
    const maximumScroll = Math.max(0, documentHeight() - innerHeight);
    const top = clamp(Number(message.top || 0), 0, maximumScroll);
    const left = Math.max(0, Number(message.left || 0));
    const commandId = safeKey(message.commandId) || ("review-scroll-" + gestureId);
    activeScrollCommand = { commandId, top, left };
    scrollTo({ top, left, behavior: "auto" });
  };
  const markerTypes = (element) => String(
    element.getAttribute("data-pageroot-review-marker-types") || "",
  ).split(/\s+/).filter(Boolean);
  const recordContains = (outer, inner, tolerance = 2) => (
    inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance
  );
  const recordsAreClose = (left, right, gap = 10) => {
    const horizontalOverlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const verticalOverlap = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const minimumWidth = Math.max(1, Math.min(left.right - left.left, right.right - right.left));
    const minimumHeight = Math.max(1, Math.min(left.bottom - left.top, right.bottom - right.top));
    const continuousLineGap = Math.max(gap, Math.min(18, minimumHeight * .8));
    const horizontalGap = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
    const verticalGap = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
    return (horizontalOverlap > 0 && verticalOverlap > 0)
      || (verticalGap <= continuousLineGap && horizontalOverlap / minimumWidth >= .35)
      || (horizontalGap <= gap && verticalOverlap / minimumHeight >= .35);
  };
  const fuseConnectedFragments = (rawFragments) => {
    const fragments = rawFragments.map((fragment) => ({ ...fragment }));
    for (let pass = 0; pass < 2; pass += 1) {
      fragments.forEach((left, leftIndex) => fragments.forEach((right, rightIndex) => {
        if (leftIndex >= rightIndex) return;
        const horizontalOverlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
        const verticalOverlap = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
        const verticalGap = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
        const horizontalGap = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
        const minimumWidth = Math.max(1, Math.min(left.right - left.left, right.right - right.left));
        const minimumHeight = Math.max(1, Math.min(left.bottom - left.top, right.bottom - right.top));
        const continuousLineGap = Math.max(10, Math.min(18, minimumHeight * .8));
        if (
          verticalGap > 0
          && verticalGap <= continuousLineGap
          && horizontalOverlap / minimumWidth >= .35
        ) {
          const midpoint = (Math.min(left.bottom, right.bottom) + Math.max(left.top, right.top)) / 2;
          if (left.top <= right.top) {
            left.bottom = midpoint;
            right.top = midpoint;
          } else {
            right.bottom = midpoint;
            left.top = midpoint;
          }
        } else if (horizontalGap > 0 && horizontalGap <= 10 && verticalOverlap / minimumHeight >= .35) {
          const midpoint = (Math.min(left.right, right.right) + Math.max(left.left, right.left)) / 2;
          if (left.left <= right.left) {
            left.right = midpoint;
            right.left = midpoint;
          } else {
            right.right = midpoint;
            left.left = midpoint;
          }
        }
      }));
    }
    return fragments;
  };
  const mergeRecordGroup = (records) => {
    const fragments = fuseConnectedFragments(records.flatMap((record) => (
      record.fragments || [{
        left: record.left,
        top: record.top,
        right: record.right,
        bottom: record.bottom,
      }]
    )));
    const boxOwner = records.find((record) => (
      record.tone === "style" && record.scope === "box" && record.ownerKey
    ));
    return {
      ...records[0],
      ownerKey: boxOwner?.ownerKey || records[0].ownerKey || "",
      scope: boxOwner ? "box" : records[0].scope,
      labelPrimary: records.some((record) => record.labelPrimary !== false),
      fragments,
      left: Math.min(...fragments.map((record) => record.left)),
      top: Math.min(...fragments.map((record) => record.top)),
      right: Math.max(...fragments.map((record) => record.right)),
      bottom: Math.max(...fragments.map((record) => record.bottom)),
      types: [...new Set(records.flatMap((record) => record.types))],
      tones: [...new Set(records.flatMap((record) => record.tones))],
    };
  };
  const mergeConnectedRecords = (records, canMerge) => {
    const remaining = [...records];
    const merged = [];
    while (remaining.length) {
      const group = [remaining.shift()];
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          if (!group.some((record) => canMerge(record, remaining[index]))) continue;
          group.push(remaining.splice(index, 1)[0]);
          expanded = true;
        }
      }
      merged.push(mergeRecordGroup(group));
    }
    return merged;
  };
  const allModeSummary = (types, summary) => {
    if (summary === "新增内容" || summary === "删除内容") return summary;
    if (types.length > 2) return "综合调整";
    if (types.includes("text") && types.includes("style")) return "文本、视觉调整";
    if (types.includes("text") && types.includes("structure")) return "文本、结构调整";
    if (types.includes("structure") && types.includes("style")) return "结构、视觉调整";
    if (types.includes("text")) return "文本调整";
    if (types.includes("structure")) return "结构调整";
    if (types.includes("style")) return "视觉调整";
    return "内容调整";
  };
  const roundedCoordinate = (value) => Math.round(value * 4) / 4;
  const unionPath = (rawRects, offsetLeft = 0, offsetTop = 0) => {
    const rects = rawRects.map((rect) => ({
      left: roundedCoordinate(rect.left - offsetLeft),
      top: roundedCoordinate(rect.top - offsetTop),
      right: roundedCoordinate(rect.right - offsetLeft),
      bottom: roundedCoordinate(rect.bottom - offsetTop),
    }));
    const xs = [...new Set(rects.flatMap((rect) => [rect.left, rect.right]))].sort((a, b) => a - b);
    const ys = [...new Set(rects.flatMap((rect) => [rect.top, rect.bottom]))].sort((a, b) => a - b);
    const filled = ys.slice(0, -1).map((top, row) => xs.slice(0, -1).map((left, column) => {
      const centerX = (left + xs[column + 1]) / 2;
      const centerY = (top + ys[row + 1]) / 2;
      return rects.some((rect) => centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom);
    }));
    const edges = [];
    const hasCell = (row, column) => Boolean(filled[row]?.[column]);
    filled.forEach((row, rowIndex) => row.forEach((inside, columnIndex) => {
      if (!inside) return;
      const left = xs[columnIndex];
      const right = xs[columnIndex + 1];
      const top = ys[rowIndex];
      const bottom = ys[rowIndex + 1];
      if (!hasCell(rowIndex - 1, columnIndex)) edges.push([[left, top], [right, top]]);
      if (!hasCell(rowIndex, columnIndex + 1)) edges.push([[right, top], [right, bottom]]);
      if (!hasCell(rowIndex + 1, columnIndex)) edges.push([[right, bottom], [left, bottom]]);
      if (!hasCell(rowIndex, columnIndex - 1)) edges.push([[left, bottom], [left, top]]);
    }));
    const pointKey = (point) => point[0] + "," + point[1];
    const paths = [];
    while (edges.length) {
      const edge = edges.shift();
      const points = [edge[0], edge[1]];
      const startKey = pointKey(edge[0]);
      let currentKey = pointKey(edge[1]);
      while (currentKey !== startKey) {
        const nextIndex = edges.findIndex((candidate) => pointKey(candidate[0]) === currentKey);
        if (nextIndex < 0) break;
        const next = edges.splice(nextIndex, 1)[0];
        points.push(next[1]);
        currentKey = pointKey(next[1]);
      }
      const simplified = points.filter((point, index) => {
        if (index === 0 || index === points.length - 1) return true;
        const previous = points[index - 1];
        const next = points[index + 1];
        return !((previous[0] === point[0] && point[0] === next[0])
          || (previous[1] === point[1] && point[1] === next[1]));
      });
      if (simplified.length > 2) {
        paths.push("M " + simplified.map((point) => point[0] + " " + point[1]).join(" L ") + " Z");
      }
    }
    return paths.join(" ");
  };
  const recordsOverlapStrongly = (left, right) => {
    const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const intersection = width * height;
    const leftArea = Math.max(1, (left.right - left.left) * (left.bottom - left.top));
    const rightArea = Math.max(1, (right.right - right.left) * (right.bottom - right.top));
    return intersection / Math.min(leftArea, rightArea) >= .62;
  };
  const contentStyleRects = (element) => {
    const rects = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        (node.textContent || "").trim()
        && parent
        && !parent.closest("script, style, noscript, template")
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1)
          .forEach((rect) => rects.push(rect));
        range.detach();
      }
      node = walker.nextNode();
    }
    return rects.length ? rects : [element.getBoundingClientRect()];
  };
  const textFootprintOwner = (element, groupId) => {
    let candidate = element.parentElement;
    while (candidate) {
      const groupIds = String(
        candidate.getAttribute("data-pageroot-review-text-block-groups") || "",
      ).split(/\s+/).filter(Boolean);
      if (groupIds.includes(groupId)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };
  const recordsShareTextLine = (left, right) => {
    const overlap = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const minimumHeight = Math.max(1, Math.min(left.bottom - left.top, right.bottom - right.top));
    const leftCenter = (left.top + left.bottom) / 2;
    const rightCenter = (right.top + right.bottom) / 2;
    return overlap / minimumHeight >= .5
      || Math.abs(leftCenter - rightCenter) <= minimumHeight * .45;
  };
  const textLineGroups = (records) => [...records]
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .reduce((lines, record) => {
      const line = lines.find((candidate) => candidate.some((item) => (
        recordsShareTextLine(item, record)
      )));
      if (line) line.push(record);
      else lines.push([record]);
      return lines;
    }, []);
  const mergeTextLineIntervals = (records) => [...records]
    .sort((left, right) => left.left - right.left)
    .reduce((intervals, record) => {
      const previous = intervals.at(-1);
      if (!previous) {
        intervals.push({ ...record });
        return intervals;
      }
      const minimumHeight = Math.max(
        1,
        Math.min(previous.bottom - previous.top, record.bottom - record.top),
      );
      const gap = Math.max(0, record.left - previous.right);
      if (gap <= Math.max(10, minimumHeight * .9)) {
        previous.left = Math.min(previous.left, record.left);
        previous.top = Math.min(previous.top, record.top);
        previous.right = Math.max(previous.right, record.right);
        previous.bottom = Math.max(previous.bottom, record.bottom);
      } else {
        intervals.push({ ...record });
      }
      return intervals;
    }, []);
  const expandTinyTextInterval = (record, ownerLines) => {
    const height = Math.max(1, record.bottom - record.top);
    const minimumWidth = Math.max(24, height * 1.6);
    if (record.right - record.left >= minimumWidth) return record;
    const ownerLine = ownerLines.find((line) => line.some((candidate) => (
      recordsShareTextLine(candidate, record)
    )));
    const ownerBounds = ownerLine ? boundsForRects(ownerLine) : null;
    if (ownerBounds && ownerBounds.right - ownerBounds.left <= minimumWidth) {
      return { ...record, left: ownerBounds.left, right: ownerBounds.right };
    }
    const center = (record.left + record.right) / 2;
    let left = center - minimumWidth / 2;
    let right = center + minimumWidth / 2;
    if (ownerBounds && left < ownerBounds.left) {
      right += ownerBounds.left - left;
      left = ownerBounds.left;
    }
    if (ownerBounds && right > ownerBounds.right) {
      left -= right - ownerBounds.right;
      right = ownerBounds.right;
    }
    return {
      ...record,
      left: ownerBounds ? Math.max(ownerBounds.left, left) : left,
      right: ownerBounds ? Math.min(ownerBounds.right, right) : right,
    };
  };
  const boundsForRects = (rects) => rects.length ? {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  } : null;
  const readableTextRecords = (records) => {
    const groups = new Map();
    records.forEach((record) => {
      const key = record.changeId + "|" + record.tone + "|" + record.textGroup;
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    });
    return [...groups.values()].flatMap((group) => {
      const base = group[0];
      const lines = textLineGroups(group);
      const density = Math.max(...group.map((record) => Number(record.textDensity || 0)));
      const owner = textFootprintOwner(base.element, base.textGroup);
      const useBlock = base.textScope === "block"
        || (lines.length > 3 && density >= .35);
      if (useBlock && owner) {
        const ownerBounds = boundsForRects(contentStyleRects(owner)
          .filter((rect) => rect.width > 1 && rect.height > 1)
          .map((rect) => ({
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
          })));
        if (ownerBounds) {
          return [{
            ...base,
            ...ownerBounds,
            element: owner,
            scope: "text-block",
            summary: base.summary === "文本调整" && base.textScope !== "block"
              ? "段落改写"
              : base.summary,
            labelPrimary: true,
          }];
        }
      }
      const multiLine = lines.length > 1;
      const ownerLines = owner ? textLineGroups(contentStyleRects(owner)
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .map((rect) => ({
          left: rect.left + scrollX,
          top: rect.top + scrollY,
          right: rect.right + scrollX,
          bottom: rect.bottom + scrollY,
        }))) : [];
      return lines.flatMap((line) => mergeTextLineIntervals(line))
        .map((record) => expandTinyTextInterval(record, ownerLines))
        .sort((left, right) => left.top - right.top || left.left - right.left)
        .map((record, index) => ({
          ...record,
          scope: multiLine ? "text-line" : "text-phrase",
          summary: multiLine && record.summary === "文本调整"
            ? "句子改写"
            : record.summary,
          labelPrimary: index === 0,
        }));
    });
  };
  function renderReviewOverlays() {
    if (projectionTransitioning) return;
    document.querySelector('[data-pageroot-review-projection-layer]')?.remove();
    const filter = currentState.filter || "all";
    const records = [];
    if (filter === "all" || filter === "text") {
      let textMarkerSequence = 0;
      document.querySelectorAll('[data-pageroot-review-marker-types~="text"]').forEach((element) => {
        textMarkerSequence += 1;
        const textToneValue = element.getAttribute("data-pageroot-review-text")
          || element.getAttribute("data-pageroot-review-text-context");
        const textTone = textToneValue === "removed" ? "text-removed" : "text-added";
        [...element.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1)
          .forEach((rect) => records.push({
            element,
            changeId: element.getAttribute("data-pageroot-review-marker") || "",
            ownerKey: "",
            textGroup: element.getAttribute("data-pageroot-review-text-group")
              || ("text-marker-" + textMarkerSequence),
            textScope: element.getAttribute("data-pageroot-review-text-scope") || "inline",
            textDensity: Number(
              element.getAttribute("data-pageroot-review-text-density") || 0,
            ),
            scope: "text",
            summary: element.getAttribute("data-pageroot-review-summary") || "",
            tone: textTone,
            tones: [textTone],
            types: ["text"],
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
          }));
      });
    }
    const selector = filter === "all"
      ? '[data-pageroot-review-marker-types~="structure"], [data-pageroot-review-marker-types~="style"]'
      : filter === "text"
        ? ""
        : '[data-pageroot-review-marker-types~="' + filter + '"]';
    if (selector) [...document.querySelectorAll(selector)]
      .forEach((element) => {
        const types = markerTypes(element).filter((type) => filter === "all" || type === filter);
        types.forEach((type) => {
          const scope = type === "style"
            ? element.getAttribute("data-pageroot-review-style-scope") || "content"
            : "element";
          const rects = type === "style" && scope === "content"
            ? contentStyleRects(element)
            : [element.getBoundingClientRect()];
          rects.forEach((rect) => records.push({
            element,
            changeId: element.getAttribute("data-pageroot-review-marker") || "",
            ownerKey: type === "style"
              ? element.getAttribute("data-pageroot-review-style-owner") || ""
              : "",
            scope,
            summary: type === "style"
              ? "视觉调整"
              : element.getAttribute("data-pageroot-review-summary") || "",
            tone: type,
            tones: [type],
            types: [type],
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
          }));
        });
      });
    const visibleRecords = records
      .filter((rect) => rect.right - rect.left > 1 && rect.bottom - rect.top > 1)
      .sort((left, right) => left.changeId.localeCompare(right.changeId) || left.top - right.top || left.left - right.left);
    const readableRecords = [
      ...visibleRecords.filter((record) => (
        record.tone !== "text-added" && record.tone !== "text-removed"
      )),
      ...readableTextRecords(visibleRecords.filter((record) => (
        record.tone === "text-added" || record.tone === "text-removed"
      ))),
    ].sort((left, right) => left.changeId.localeCompare(right.changeId) || left.top - right.top || left.left - right.left);
    const dominantStyleBoxes = readableRecords.filter((record) => (
      record.tone === "style" && record.scope === "box"
    ));
    const minimalRecords = readableRecords.filter((record, index) => {
      if (record.tone === "style") {
        const dominatedByBoxOwner = dominantStyleBoxes.some((candidate) => (
          candidate !== record
          && candidate.changeId === record.changeId
          && candidate.ownerKey !== record.ownerKey
          && candidate.element.contains(record.element)
          && recordContains(candidate, record)
        ));
        if (dominatedByBoxOwner) return false;
        if (record.scope === "box") return true;
      }
      return !readableRecords.some((candidate, candidateIndex) => {
        if (index === candidateIndex || record.changeId !== candidate.changeId || record.tone !== candidate.tone) return false;
        const recordArea = (record.right - record.left) * (record.bottom - record.top);
        const candidateArea = (candidate.right - candidate.left) * (candidate.bottom - candidate.top);
        return candidateArea < recordArea * .86 && recordContains(record, candidate);
      });
    });
    const textRecords = minimalRecords.filter((record) => (
      record.tone === "text-added" || record.tone === "text-removed"
    ));
    const nonTextRecords = minimalRecords.filter((record) => (
      record.tone !== "text-added" && record.tone !== "text-removed"
    ));
    let merged = [
      ...textRecords,
      ...mergeConnectedRecords(nonTextRecords, (left, right) => (
        left.changeId === right.changeId
        && left.tone === right.tone
        && (left.tone !== "style" || left.ownerKey === right.ownerKey)
        && recordsAreClose(left, right)
      )),
    ].sort((left, right) => left.changeId.localeCompare(right.changeId) || left.top - right.top || left.left - right.left);
    if (filter === "all") {
      merged = mergeConnectedRecords(merged, (left, right) => (
        left.changeId === right.changeId && recordsOverlapStrongly(left, right)
      )).map((record) => ({
        ...record,
        tone: record.tones.length > 1 ? "mixed" : record.tones[0],
        summary: allModeSummary(record.types, record.summary),
      }));
    }
    const inset = 3;
    const documentWidth = Math.max(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const height = Math.max(innerHeight, documentHeight());
    const layer = document.createElement("div");
    layer.setAttribute("data-pageroot-review-projection-layer", "true");
    layer.style.setProperty("width", documentWidth + "px", "important");
    layer.style.setProperty("height", height + "px", "important");
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("data-pageroot-review-mask-layer", "true");
    svg.setAttribute("width", String(documentWidth));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + documentWidth + " " + height);
    svg.style.setProperty("width", documentWidth + "px", "important");
    svg.style.setProperty("height", height + "px", "important");
    const holePaths = [];
    merged.forEach((record) => {
      const fragments = (record.fragments || [{
        left: record.left,
        top: record.top,
        right: record.right,
        bottom: record.bottom,
      }]).map((fragment) => ({
        left: fragment.left - inset,
        top: fragment.top - inset,
        right: fragment.right + inset,
        bottom: fragment.bottom + inset,
      }));
      const pathData = unionPath(fragments);
      record.renderFragments = fragments;
      record.pathData = pathData;
      const hole = document.createElementNS(namespace, "path");
      hole.setAttribute("data-pageroot-review-mask-hole", record.changeId);
      if (record.ownerKey) {
        hole.setAttribute("data-pageroot-review-mask-owner", record.ownerKey);
      }
      const left = record.left - inset;
      const top = record.top - inset;
      const width = record.right - record.left + inset * 2;
      const holeHeight = record.bottom - record.top + inset * 2;
      hole.setAttribute("d", pathData);
      hole.setAttribute("data-left", String(left));
      hole.setAttribute("data-top", String(top));
      hole.setAttribute("data-width", String(width));
      hole.setAttribute("data-height", String(holeHeight));
      hole.setAttribute("fill", "none");
      holePaths.push(pathData);
      svg.append(hole);
    });
    const dim = document.createElementNS(namespace, "path");
    dim.setAttribute("data-pageroot-review-mask-dim", "true");
    dim.setAttribute(
      "d",
      "M 0 0 H " + documentWidth + " V " + height + " H 0 Z " + holePaths.join(" "),
    );
    dim.setAttribute("fill", "#ffffff");
    dim.setAttribute("fill-rule", "evenodd");
    dim.setAttribute("clip-rule", "evenodd");
    const contextVisibility = Math.max(0, Math.min(100, Number(currentState.transparency ?? 18))) / 100;
    dim.setAttribute("fill-opacity", String(Math.round((1 - contextVisibility) * 1_000) / 1_000));
    svg.prepend(dim);
    layer.append(svg);
    merged.forEach((record) => {
      const box = document.createElement("div");
      box.setAttribute("data-pageroot-review-overlay-box", record.changeId);
      if (record.ownerKey) {
        box.setAttribute("data-pageroot-review-overlay-owner", record.ownerKey);
      }
      box.dataset.tone = record.tone;
      box.dataset.tones = record.tones.join(" ");
      box.dataset.types = record.types.join(" ");
      box.dataset.scope = record.scope || "element";
      box.dataset.summary = record.summary;
      if (record.textGroup) box.dataset.textGroup = record.textGroup;
      box.setAttribute(
        "data-pageroot-review-fragment-count",
        String((record.renderFragments || []).length || 1),
      );
      const active = currentState.focus !== "all" && currentState.focus === record.changeId;
      box.dataset.active = active ? "true" : "false";
      const left = record.left - inset;
      const top = record.top - inset;
      const width = record.right - record.left + inset * 2;
      const boxHeight = record.bottom - record.top + inset * 2;
      box.style.setProperty("left", left + "px", "important");
      box.style.setProperty("top", top + "px", "important");
      box.style.setProperty("width", width + "px", "important");
      box.style.setProperty("height", boxHeight + "px", "important");
      if ((record.renderFragments || []).length > 1) {
        box.dataset.shaped = "true";
        const shapeSvg = document.createElementNS(namespace, "svg");
        shapeSvg.setAttribute("data-pageroot-review-overlay-shape-svg", "true");
        shapeSvg.setAttribute("viewBox", "0 0 " + width + " " + boxHeight);
        shapeSvg.setAttribute("preserveAspectRatio", "none");
        const shape = document.createElementNS(namespace, "path");
        shape.setAttribute("data-pageroot-review-overlay-shape", "true");
        shape.setAttribute("d", unionPath(record.renderFragments, left, top));
        shapeSvg.append(shape);
        box.append(shapeSvg);
      }
      if (record.labelPrimary !== false) {
        const label = document.createElement("span");
        label.setAttribute("data-pageroot-review-overlay-label", "true");
        label.textContent = record.summary || "内容调整";
        box.append(label);
      }
      layer.append(box);
    });
    document.body.append(layer);
    document.documentElement.dataset.pagerootReviewOverlays = merged.length ? "true" : "false";
    scheduleLayoutReport();
  }
  const applyState = (state) => {
    currentState = { ...currentState, ...state };
    const root = document.documentElement;
    root.dataset.pagerootReviewFilter = state.filter || "all";
    root.dataset.pagerootReviewFocus = state.focus || "all";
    const transparency = Math.max(0, Math.min(100, Number(state.transparency ?? 18))) / 100;
    root.style.setProperty("--pageroot-review-context-opacity", String(transparency));
    root.style.setProperty("--pageroot-review-context-grayscale", String((1 - transparency) * .55));
    root.style.setProperty("--pageroot-review-context-saturation", String(.7 + transparency * .3));
    root.style.setProperty("--pageroot-review-ui-scale", String(1 / Math.max(.32, Math.min(1, Number(state.scale || 1)))));
    document.querySelectorAll("[data-pageroot-outline-id]").forEach((element) => {
      element.dataset.pagerootReviewActive = state.focus === "all"
        || element.dataset.pagerootReviewId === state.focus
        || element.dataset.pagerootOutlineId === state.focus
        ? "true"
        : "false";
    });
    document.querySelectorAll("[data-pageroot-review-marker]").forEach((element) => {
      element.dataset.pagerootReviewActive = state.focus !== "all"
        && element.getAttribute("data-pageroot-review-marker") === state.focus
        ? "true"
        : "false";
    });
    if (projectionTransitioning) renderTransitionMask();
    else scheduleOverlayRender();
  };
  addEventListener("message", (event) => {
    const message = event.data;
    if (
      !event.isTrusted
      || event.source !== parent
      || !message
      || message.source !== "pageroot-ai-review-parent"
      || message.sessionId !== sessionId
    ) return;
    if (message.type === "request-runtime-visual-channel") {
      stopImmediateMessagePropagation(event);
      transferRuntimeVisualChannel(message.challenge);
      return;
    }
    if (message.type === "state") applyState(message.state || {});
    if (message.type === "apply-runtime-visual-changes") {
      applyRuntimeVisualChanges(message.markers);
    }
    if (message.type === "scroll-owner") applyScrollOwner(message);
    if (message.type === "set-scroll-position") applyScrollPosition(message);
    if (message.type === "begin-presentation") beginProjectionTransition(message.presentationEpoch);
    if (message.type === "activate-panel") {
      if (!projectionTransitioning) beginProjectionTransition(message.presentationEpoch);
      activatePanelPath(message.panelPath?.length ? message.panelPath : [message.panelKey]);
      schedulePresentationReady(message.presentationEpoch);
    }
    if (message.type === "commit-presentation") commitProjectionTransition(message.presentationEpoch);
    if (message.type === "mirror-action") mirrorAction(message);
    if (message.type === "focus-change") {
      const changeId = String(message.changeId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-review-id="' + changeId + '"]');
      focusTarget(target, message.panelPath?.length ? message.panelPath : message.panelKey);
    }
    if (message.type === "focus-outline") {
      const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]');
      focusTarget(target, message.panelPath?.length ? message.panelPath : message.panelKey);
    }
  }, true);
  addEventListener("click", (event) => {
    post("interaction");
    const action = event.target instanceof Element
      ? event.target.closest("[data-pageroot-review-action-key]")
      : null;
    if (action && !mirroringAction && !mirroringPanel) {
      const actionKey = action.getAttribute("data-pageroot-review-action-key") || "";
      const panelKey = action.closest("[data-pageroot-review-panel-key]")
        ?.getAttribute("data-pageroot-review-panel-key") || "";
      const panelPath = safePanelPath(
        action.getAttribute("data-pageroot-review-panel-path")
        || action.closest("[data-pageroot-review-panel-path]")
          ?.getAttribute("data-pageroot-review-panel-path"),
      );
      scheduleOverlayRender();
      requestAnimationFrame(() => {
        post("action", {
          actionKey,
          panelKey,
          panelPath,
          panelControl: isSafePanelControl(action),
        });
        requestAnimationFrame(scheduleOverlayRender);
      });
    }
    const control = event.target instanceof Element
      ? event.target.closest('[data-pageroot-review-panel-control="true"][data-pageroot-review-panel-key]')
      : null;
    if (control && !mirroringPanel && !mirroringAction) {
      const panelKey = control.getAttribute("data-pageroot-review-panel-key") || "";
      const panelPath = safePanelPath(
        control.getAttribute("data-pageroot-review-panel-path") || panelKey,
      );
      const localEpoch = beginProjectionTransition(projectionEpoch + 1);
      requestAnimationFrame(() => {
        post("panel-change", { panelKey, panelPath, presentationEpoch: localEpoch });
      });
    }
    if (event.target instanceof Element && event.target.closest("a[href], area[href]")) {
      event.preventDefault();
    }
  }, true);
  const postControlState = (event) => {
    if (mirroringAction || mirroringPanel) return;
    const action = event.target instanceof Element
      ? event.target.closest("[data-pageroot-review-action-key]")
      : null;
    if (!(action instanceof HTMLInputElement || action instanceof HTMLSelectElement || action instanceof HTMLTextAreaElement)) return;
    post("control-state", {
      actionKey: action.getAttribute("data-pageroot-review-action-key") || "",
      panelKey: action.closest("[data-pageroot-review-panel-key]")
        ?.getAttribute("data-pageroot-review-panel-key") || "",
      panelPath: safePanelPath(
        action.getAttribute("data-pageroot-review-panel-path")
        || action.closest("[data-pageroot-review-panel-path]")
          ?.getAttribute("data-pageroot-review-panel-path"),
      ),
      value: action.value,
      checked: action instanceof HTMLInputElement ? action.checked : undefined,
    });
  };
  addEventListener("input", postControlState, true);
  addEventListener("change", postControlState, true);
  addEventListener("submit", (event) => event.preventDefault(), true);
  const announceScrollIntent = () => {
    activeScrollCommand = null;
    acceptsFollowerScroll = false;
    followerGestureId = 0;
    post("scroll-intent");
  };
  addEventListener("wheel", announceScrollIntent, { capture: true, passive: true });
  addEventListener("touchstart", announceScrollIntent, { capture: true, passive: true });
  addEventListener("pointerdown", announceScrollIntent, { capture: true, passive: true });
  addEventListener("keydown", (event) => {
    const scrollKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar",
    ]);
    if (!scrollKeys.has(event.key)) return;
    if (
      event.target instanceof Element
      && event.target.closest('input, textarea, select, [contenteditable="true"]')
    ) return;
    announceScrollIntent();
  }, true);
  addEventListener("scroll", () => {
    const command = activeScrollCommand;
    const commandMatches = command
      && Math.abs(scrollY - command.top) <= 1
      && Math.abs(scrollX - command.left) <= 1;
    if (command && !commandMatches) activeScrollCommand = null;
    post("scroll-position", {
      top: scrollY,
      left: scrollX,
      commandId: commandMatches ? command.commandId : "",
    });
    if (commandMatches && activeScrollCommand === command) activeScrollCommand = null;
  }, { passive: true });
  const handleLayoutChange = () => {
    if (projectionTransitioning) {
      renderTransitionMask();
      schedulePresentationReady(projectionEpoch);
    } else {
      scheduleOverlayRender();
      scheduleLayoutReport();
    }
  };
  addEventListener("resize", handleLayoutChange, { passive: true });
  const mutationObserver = new MutationObserver((mutations) => {
    const onlyOverlayChanges = mutations.every((mutation) => {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => (
        node instanceof Element
        && (node.matches("[data-pageroot-review-projection-layer], [data-pageroot-review-transition-mask]")
          || Boolean(node.closest("[data-pageroot-review-projection-layer], [data-pageroot-review-transition-mask]")))
      ));
    });
    if (!onlyOverlayChanges) handleLayoutChange();
  });
  if (document.body) mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-hidden", "aria-selected", "class", "hidden", "open", "style"],
  });
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(handleLayoutChange)
    : null;
  if (resizeObserver && document.body) resizeObserver.observe(document.body);
  const announceReady = () => post("ready", {
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  });
  const ready = async () => {
    const runtimeVisualSnapshots = await collectRuntimeVisualSnapshots().catch(() => null);
    if (runtimeVisualSnapshots !== null) {
      runtimeVisualSnapshotBatch = runtimeVisualSnapshots;
      publishRuntimeVisualSnapshots();
    }
    announceReady();
    scheduleLayoutReport(true);
    document.fonts?.ready?.then(() => {
      scheduleOverlayRender();
      scheduleLayoutReport();
    }).catch(() => {});
  };
  if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", () => { void ready(); }, { once: true });
  } else {
    void ready();
  }
})();
`;
}

function prepareDocument(
  document: Document,
  side: ReviewSide,
  sessionId: string,
  sourcePath?: string,
  externalBootstrap = false,
  runtimeVisualCandidateKeys: readonly string[] = [],
): { html: string; bootstrapJavaScript: string } {
  document.querySelectorAll("meta[http-equiv]").forEach((element) => {
    const directive = (element.getAttribute("http-equiv") || "").trim().toLowerCase();
    if (
      directive === "refresh"
      || directive === "content-security-policy"
      || directive === "content-security-policy-report-only"
    ) element.remove();
  });
  document.querySelectorAll("*").forEach((element) => {
    if (element.tagName === "IFRAME") {
      element.setAttribute("sandbox", "");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
  });

  document.documentElement.dataset.pagerootReviewSide = side;
  document.documentElement.dataset.pagerootReviewFilter = "all";
  document.documentElement.dataset.pagerootReviewFocus = "all";

  const style = document.createElement("style");
  style.id = REVIEW_STYLE_ID;
  style.textContent = REVIEW_DOCUMENT_STYLE;

  const bootstrap = document.createElement("script");
  bootstrap.setAttribute(REVIEW_BOOTSTRAP_ATTRIBUTE, "true");
  const bootstrapJavaScript = reviewBootstrap(
    sessionId,
    side,
    runtimeVisualCandidateKeys,
  );
  if (externalBootstrap) {
    bootstrap.src = REVIEW_BOOTSTRAP_PATH;
  } else {
    bootstrap.textContent = bootstrapJavaScript;
  }

  const baseHref = externalBootstrap ? undefined : baseHrefFromSourcePath(sourcePath);
  if (baseHref && !document.head.querySelector("base")) {
    const base = document.createElement("base");
    base.href = baseHref;
    base.setAttribute(REVIEW_BASE_ATTRIBUTE, "true");
    document.head.insertBefore(base, document.head.firstChild);
  }
  document.head.prepend(bootstrap);
  document.head.append(style);
  return {
    html: `${doctypeString(document.doctype)}\n${document.documentElement.outerHTML}`,
    bootstrapJavaScript,
  };
}

export function buildReviewDocuments(
  beforeHtml: string,
  afterHtml: string,
  options: {
    sessionId: string;
    sourcePath?: string;
    externalBootstrap?: boolean;
    comments?: readonly CommentItem[];
  },
): ReviewDocuments {
  if (typeof DOMParser === "undefined") {
    return {
      before: beforeHtml,
      after: afterHtml,
      bootstrapJavaScript: {
        before: reviewBootstrap(options.sessionId, "before"),
        after: reviewBootstrap(options.sessionId, "after"),
      },
      changes: [],
      outline: [],
      runtimeVisualCandidates: [],
      commentGroups: [],
    };
  }
  const parser = new DOMParser();
  const comments = options.comments || [];
  const sourceProjection = prepareReviewCommentSourceProjection(
    beforeHtml,
    comments.length > 0,
  );
  const beforeDocument = parser.parseFromString(sourceProjection.html, "text/html");
  const afterDocument = parser.parseFromString(afterHtml, "text/html");
  clearReservedReviewMarkup(beforeDocument, sourceProjection.projected);
  clearReservedReviewMarkup(afterDocument);
  const commentGroups = annotateReviewComments(
    beforeDocument,
    beforeHtml,
    comments,
    sourceProjection.sourceIndex,
  );
  beforeDocument.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
  });
  annotatePanelPairs(beforeDocument, afterDocument);
  annotateActionPairs(beforeDocument, afterDocument);
  const pairs = pairSections(
    candidateSections(beforeDocument),
    candidateSections(afterDocument),
  );
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];
  const runtimeSections: ReviewRuntimeSectionContext[] = [];

  pairs.forEach((pair, pairIndex) => {
    const outlineId = `outline-${outline.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const types = annotateChangePair(pair);
    const changeId = types.length ? `change-${changes.length + 1}` : undefined;
    const helper = types.length
      ? helperText(types, Boolean(pair.before), Boolean(pair.after), pair)
      : "本轮未修改";
    if (changeId) attachChangeMarkerMetadata(pair, changeId, helper);
    const movement = pair.moved
      ? { from: pair.beforeIndex + 1, to: pair.afterIndex + 1 }
      : undefined;
    const panelPath = panelPathForElement(pair.after).length
      ? panelPathForElement(pair.after)
      : panelPathForElement(pair.before);
    const panelKey = panelPath.at(-1);
    runtimeSections.push({
      pair,
      outlineId,
      ...(changeId ? { changeId } : {}),
      label,
      ...(panelKey ? { panelKey } : {}),
      panelPath,
    });
    [pair.before, pair.after].forEach((element) => {
      if (!element) return;
      element.setAttribute("data-pageroot-outline-id", outlineId);
      element.setAttribute("data-pageroot-review-active", "false");
      if (changeId) {
        element.setAttribute("data-pageroot-review-id", changeId);
        element.setAttribute("data-pageroot-review-types", types.join(" "));
        element.setAttribute("data-pageroot-review-summary", helper);
      }
    });
    if (changeId) {
      changes.push({
        id: changeId,
        label,
        helper,
        types,
        beforePresent: Boolean(pair.before),
        afterPresent: Boolean(pair.after),
        ...(panelKey ? { panelKey } : {}),
        ...(panelPath.length ? { panelPath } : {}),
        ...(movement ? { movement } : {}),
      });
    }
    const preferredElement = pair.after || pair.before;
    const preferredDocument = pair.after ? afterDocument : beforeDocument;
    outline.push({
      id: outlineId,
      group: regionGroupLabel(preferredElement, preferredDocument),
      label,
      helper,
      types,
      ...(changeId ? { changeId } : {}),
      ...(panelKey ? { panelKey } : {}),
      ...(panelPath.length ? { panelPath } : {}),
      ...(movement ? { movement } : {}),
    });
  });

  const runtimeVisualCandidates = options.externalBootstrap
    ? annotateRuntimeVisualCandidates(
        beforeDocument,
        afterDocument,
        runtimeSections,
      )
    : [];
  const runtimeVisualCandidateKeys = runtimeVisualCandidates.map(({ key }) => key);

  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    runtimeVisualCandidateKeys,
  );
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    runtimeVisualCandidateKeys,
  );
  return {
    before: preparedBefore.html,
    after: preparedAfter.html,
    bootstrapJavaScript: {
      before: preparedBefore.bootstrapJavaScript,
      after: preparedAfter.bootstrapJavaScript,
    },
    changes,
    outline,
    runtimeVisualCandidates,
    commentGroups,
  };
}
