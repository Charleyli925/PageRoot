import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor.types";
import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
} from "../domain/runtime-visual-contract.js";
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
  reviewSentenceRanges,
  reviewTextSimilarity,
  sentenceAwareTextDifferences,
} from "../lib/review-text-diff.js";
import type {
  ReviewTextChangeOperation,
  ReviewTextChangeScope,
} from "../lib/review-text-diff.js";
import {
  appendReviewProjectionFact,
  parseReviewProjectionFacts,
  serializeReviewProjectionFacts,
} from "../lib/review-projection-facts.js";
import type {
  ReviewProjectionFact,
} from "../lib/review-projection-facts.js";
import { alignReviewSemanticUnits } from "../lib/review-semantic-alignment.js";
import type {
  ReviewSemanticAlignmentMatch,
} from "../lib/review-semantic-alignment.js";
import {
  REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT,
  selectPrioritizedReviewRuntimeVisualCandidates,
} from "../lib/review-runtime-visual.js";
import type {
  ReviewRuntimeVisualCandidate,
} from "../lib/review-runtime-visual.js";
import {
  REVIEW_SOURCE_NODE_ATTRIBUTE,
  prepareReviewCommentSourceProjection,
  resolveReviewCommentSourceElement,
} from "../lib/review-comment-source-map.js";
import type { CommentItem } from "./types";
import {
  createReviewRuntimeVisualCaptureIdentity,
} from "./review-runtime-capture-adapter";
import type {
  ReviewRuntimeVisualCaptureAdapter,
  ReviewRuntimeVisualCaptureIdentity,
  ReviewRuntimeVisualBootstrapRequest,
} from "./review-runtime-capture-adapter";

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
  bootstrapFallbackJavaScript: Record<ReviewSide, string>;
  changes: ReviewChange[];
  outline: ReviewOutlineItem[];
  runtimeVisualCandidates: ReviewRuntimeVisualCandidate[];
  runtimeVisualCaptureIdentity: ReviewRuntimeVisualCaptureIdentity;
  commentGroups: ReviewCommentGroup[];
  commentTargets: ReviewCommentTarget[];
};

export type ReviewCommentGroup = {
  key: string;
  items: Array<{
    text: string;
    attachmentCount: number;
  }>;
};

export type ReviewCommentTarget = {
  key: string;
  global: boolean;
  selector?: string;
  sourceNodeId?: string;
};

type ReviewCommentAnnotations = {
  groups: ReviewCommentGroup[];
  targets: ReviewCommentTarget[];
};

const REVIEW_STYLE_ID = "pageroot-ai-review-style";
const REVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-ai-review-bootstrap";
const REVIEW_BASE_ATTRIBUTE = "data-pageroot-ai-review-base";
const REVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";
const REVIEW_PROJECTION_FACTS_ATTRIBUTE = "data-pageroot-review-projection-facts";
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

  html body [data-pageroot-review-text][data-pageroot-review-marker] {
    display: contents !important;
    position: static !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    font: inherit !important;
    letter-spacing: inherit !important;
    word-spacing: inherit !important;
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
    outline: none !important;
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
    outline: none !important;
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
    outline: none !important;
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
    outline: none !important;
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
    outline: none !important;
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

const REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES = [
  "class",
  "height",
  "hidden",
  "style",
  "width",
];
const REVIEW_COMMENT_KEY_ATTRIBUTE = "data-pageroot-review-comment-key";
const REVIEW_COMMENT_GLOBAL_ATTRIBUTE = "data-pageroot-review-comment-global";
const REVIEW_COMMENT_MARKUP_ATTRIBUTE_PATTERN =
  /\sdata-pageroot-review-comment-(?:key|global)="[^"]*"/gu;
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
  nodes: Array<{ node: Text; start: number; end: number; nodeOffset: number }>;
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

function reviewTextInventory(element: Element | null): ReviewTextInventory {
  return element
    ? reviewTextInventoryForNodes(element.childNodes)
    : { text: "", nodes: [], breakOffsets: [] };
}

const normalizedTextCache = new WeakMap<Element, string>();
const normalizedMarkupCache = new WeakMap<Element, string>();
const visualSignatureCache = new WeakMap<Element, string>();
const classTokenCache = new WeakMap<Element, string[]>();
const conciseTextCache = new WeakMap<Element, string>();

function normalizedText(element: Element | null): string {
  if (!element) return "";
  const cached = normalizedTextCache.get(element);
  if (cached !== undefined) return cached;
  const value = reviewTextInventory(element).text.replace(/\s+/g, " ").trim();
  normalizedTextCache.set(element, value);
  return value;
}

function normalizedMarkup(element: Element): string {
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

function reviewStylesheetSignature(document: Document): string {
  return [...document.querySelectorAll("style, link[rel~='stylesheet' i]")]
    .map((element) => normalizedMarkup(element))
    .join("\u001e");
}

function ancestorMarkupSignature(element: Element): string {
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
  const cached = visualSignatureCache.get(element);
  if (cached !== undefined) return cached;
  const value = [...element.attributes]
    .filter((attribute) => VISUAL_ATTRIBUTE_NAMES.has(attribute.name.toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => `${attribute.name.toLowerCase()}=${attribute.value}`)
    .join("\u001f");
  visualSignatureCache.set(element, value);
  return value;
}

function classTokens(element: Element): string[] {
  const cached = classTokenCache.get(element);
  if (cached) return cached;
  const value = [...element.classList].map((token) => token.toLowerCase());
  classTokenCache.set(element, value);
  return value;
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

function uniqueSignatureMap<T>(
  items: T[],
  signature: (item: T) => string | null,
): Map<string, T | null> {
  const result = new Map<string, T | null>();
  items.forEach((item) => {
    const key = signature(item);
    if (!key) return;
    result.set(key, result.has(key) ? null : item);
  });
  return result;
}

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
  const afterByKey = new Map<string, Element | null>();
  const afterIndexByElement = new Map(
    after.map((element, index) => [element, index]),
  );
  after.forEach((element) => {
    const key = pairKey(element);
    if (!key) return;
    afterByKey.set(key, afterByKey.has(key) ? null : element);
  });

  before.forEach((beforeElement) => {
    const key = pairKey(beforeElement);
    const afterElement = key ? afterByKey.get(key) || null : null;
    if (!afterElement || usedAfter.has(afterElement)) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });

  const exactSectionSignature = (element: Element) => (
    pairKey(element)
      ? null
      : `${element.tagName}\u0000${regionContextKey(element)}\u0000${normalizedMarkup(element)}`
  );
  const uniqueBeforeMarkup = uniqueSignatureMap(before, exactSectionSignature);
  const uniqueAfterMarkup = uniqueSignatureMap(after, exactSectionSignature);
  uniqueBeforeMarkup.forEach((beforeElement, signature) => {
    const afterElement = uniqueAfterMarkup.get(signature);
    if (
      !beforeElement
      || !afterElement
      || assignments.has(beforeElement)
      || usedAfter.has(afterElement)
    ) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });

  const stableSectionSignature = (element: Element) => {
    if (pairKey(element)) return null;
    const accessibleIdentity = ["aria-label", "data-title", "name", "title"]
      .map((attribute) => element.getAttribute(attribute)?.trim() || "")
      .filter(Boolean);
    const heading = conciseElementText(directHeading(element));
    const distinctiveClasses = classTokens(element).filter((token) => ![
      "active", "card", "col", "column", "container", "content", "grid", "item",
      "main", "panel", "row", "section", "selected", "wrap", "wrapper",
    ].includes(token));
    if (!accessibleIdentity.length && !heading && !distinctiveClasses.length) {
      return null;
    }
    return [
      element.tagName,
      regionContextKey(element),
      accessibleIdentity.join("\u001f"),
      heading,
      distinctiveClasses.sort().join("\u001f"),
    ].join("\u0000");
  };
  const uniqueBeforeIdentity = uniqueSignatureMap(
    before.filter((element) => !assignments.has(element)),
    stableSectionSignature,
  );
  const uniqueAfterIdentity = uniqueSignatureMap(
    after.filter((element) => !usedAfter.has(element)),
    stableSectionSignature,
  );
  uniqueBeforeIdentity.forEach((beforeElement, signature) => {
    const afterElement = uniqueAfterIdentity.get(signature);
    if (!beforeElement || !afterElement) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });

  const afterBuckets = new Map<string, Element[]>();
  after.forEach((afterElement) => {
    if (pairKey(afterElement) || usedAfter.has(afterElement)) return;
    const bucketKey = `${afterElement.tagName}\u0000${regionContextKey(afterElement)}`;
    const bucket = afterBuckets.get(bucketKey) ?? [];
    bucket.push(afterElement);
    afterBuckets.set(bucketKey, bucket);
  });
  const edges = before.flatMap((beforeElement, beforeIndex) => (
    assignments.has(beforeElement) || pairKey(beforeElement)
      ? []
      : (afterBuckets.get(
          `${beforeElement.tagName}\u0000${regionContextKey(beforeElement)}`,
        ) ?? []).map((afterElement) => ({
        beforeElement,
        afterElement,
        score: sectionPairScore(
          beforeElement,
          afterElement,
          beforeIndex,
          afterIndexByElement.get(afterElement) ?? -1,
        ),
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
      afterIndex: afterElement
        ? afterIndexByElement.get(afterElement) ?? -1
        : -1,
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

type ReviewBootstrapElementBinding = {
  path: number[];
  tagName: string;
  sourceBoxSignature: string;
  identityAttributes: Array<[string, string]>;
  identityText?: string;
};

type ReviewRuntimeVisualBootstrapBinding = ReviewBootstrapElementBinding & {
  key: string;
};

type ReviewCommentBootstrapBinding = ReviewBootstrapElementBinding & {
  sourceNodeId: string;
};

type ReviewRuntimeVisualAnnotations = {
  candidates: ReviewRuntimeVisualCandidate[];
  bindings: Record<ReviewSide, ReviewRuntimeVisualBootstrapBinding[]>;
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

function reviewBootstrapElementBinding(
  document: Document,
  element: Element,
  includeIdentityText = false,
): ReviewBootstrapElementBinding | null {
  const root = document.documentElement;
  if (!root) return null;
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    const index = [...parent.children].indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    if (path.length > 256) return null;
    current = parent;
  }
  if (current !== root) return null;
  const nonReviewAttributes = [...element.attributes].filter((attribute) => (
    !attribute.name.startsWith("data-pageroot-")
    && !REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES.includes(attribute.name)
  ));
  const identityAttributePriority = (name: string) => {
    if (name === "id") return 0;
    if (name === "name" || name === "aria-label") return 1;
    if (name.startsWith("data-")) return 2;
    return 3;
  };
  const identityAttributes = (nonReviewAttributes.some(
    (attribute) => attribute.name !== "class",
  )
    ? nonReviewAttributes.filter((attribute) => attribute.name !== "class")
    : nonReviewAttributes
  ).map((attribute) => [attribute.name, attribute.value] as [string, string])
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      identityAttributePriority(leftName) - identityAttributePriority(rightName)
      || leftName.localeCompare(rightName)
      || leftValue.localeCompare(rightValue)
    ))
    .slice(0, RUNTIME_VISUAL_CONTRACT.identityAttributeLimit);
  // A truncated fingerprint is never evidence of identity. Even an id/name
  // anchor can be shared by an authored parser decoy while an omitted
  // attribute distinguishes the real source target, so drop every binding
  // that cannot be represented completely.
  if (nonReviewAttributes.length > RUNTIME_VISUAL_CONTRACT.identityAttributeLimit) return null;
  const identityText = includeIdentityText
    ? (element.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 1024)
    : "";
  return {
    path,
    tagName: element.tagName,
    sourceBoxSignature: JSON.stringify(
      REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES.map((attribute) => [
        attribute,
        element.getAttribute(attribute),
      ]),
    ),
    identityAttributes,
    ...(identityText ? { identityText } : {}),
  };
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

function isLocalReviewCommentTarget(element: Element): boolean {
  return element.hasAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE)
    && element.getAttribute(REVIEW_COMMENT_GLOBAL_ATTRIBUTE) !== "true";
}

function runtimeVisualCommentMatch(host: Element): {
  priority: number;
  target: Element;
} | null {
  if (isLocalReviewCommentTarget(host)) return { priority: 3, target: host };
  let candidate = host.parentElement;
  while (candidate) {
    if (isLocalReviewCommentTarget(candidate)) {
      return { priority: 2, target: candidate };
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function localRuntimeVisualCommentTargets(sectionRoot: Element): Element[] {
  const targets = new Set<Element>();
  if (isLocalReviewCommentTarget(sectionRoot)) targets.add(sectionRoot);
  sectionRoot.querySelectorAll(`[${REVIEW_COMMENT_KEY_ATTRIBUTE}]`).forEach((target) => {
    if (isLocalReviewCommentTarget(target)) targets.add(target);
  });
  return [...targets];
}

function runtimeVisualHostAncestorCounts(
  sectionRoot: Element,
  hostPairs: readonly ReviewRuntimeHostPair[],
): Map<Element, number> {
  const counts = new Map<Element, number>();
  hostPairs.forEach((hostPair) => {
    let candidate: Element | null = hostPair.before;
    while (candidate) {
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
      if (candidate === sectionRoot) break;
      candidate = candidate.parentElement;
    }
  });
  return counts;
}

function nearestRuntimeVisualCommentGroup(
  target: Element,
  sectionRoot: Element,
  hostAncestorCounts: ReadonlyMap<Element, number>,
): Element | null {
  if (target !== sectionRoot && !sectionRoot.contains(target)) return null;
  let candidate: Element | null = target;
  while (candidate) {
    if ((hostAncestorCounts.get(candidate) || 0) >= 2) return candidate;
    if (candidate === sectionRoot) return null;
    candidate = candidate.parentElement;
  }
  return null;
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
): ReviewRuntimeVisualAnnotations {
  const beforeScripts = reviewScriptDescriptors(beforeDocument);
  const afterScripts = reviewScriptDescriptors(afterDocument);
  const changedScripts = changedReviewScripts(beforeScripts, afterScripts);
  const bindings: Record<ReviewSide, ReviewRuntimeVisualBootstrapBinding[]> = {
    before: [],
    after: [],
  };
  if (!changedScripts.length) return { candidates: [], bindings };
  const proposed: Array<{
    before: Element;
    after: Element;
    section: ReviewRuntimeSectionContext;
    commentPriority: number;
    requiresDeterministicConfirmation: boolean;
  }> = [];
  const usedBefore = new Set<Element>();
  const usedAfter = new Set<Element>();
  sections.forEach((section) => {
    if (!section.pair.before || !section.pair.after) return;
    const hostPairs = pairRuntimeVisualHosts(section.pair.before, section.pair.after);
    const hostAncestorCounts = runtimeVisualHostAncestorCounts(
      section.pair.before,
      hostPairs,
    );
    const commentMatches = new Map<Element, ReturnType<typeof runtimeVisualCommentMatch>>();
    const commentGroups = new Set<Element>();
    localRuntimeVisualCommentTargets(section.pair.before).forEach((target) => {
      const group = nearestRuntimeVisualCommentGroup(
        target,
        section.pair.before as Element,
        hostAncestorCounts,
      );
      if (group) commentGroups.add(group);
    });
    hostPairs.forEach((hostPair) => {
      const match = runtimeVisualCommentMatch(hostPair.before);
      commentMatches.set(hostPair.before, match);
    });
    hostPairs.forEach((hostPair) => {
      let commentPriority = commentMatches.get(hostPair.before)?.priority || 0;
      if (!commentPriority) {
        for (const group of commentGroups) {
          if (group === hostPair.before || group.contains(hostPair.before)) {
            commentPriority = 1;
            break;
          }
        }
      }
      const runtimeVisualCause = hasRuntimeVisualCause(hostPair, changedScripts);
      if (
        usedBefore.has(hostPair.before)
        || usedAfter.has(hostPair.after)
        || staticReviewMarkerCoversRuntimeHost(hostPair.before, section.pair.before as Element)
        || staticReviewMarkerCoversRuntimeHost(hostPair.after, section.pair.after as Element)
        || (
          commentPriority === 0
          && !runtimeVisualCause
        )
      ) return;
      usedBefore.add(hostPair.before);
      usedAfter.add(hostPair.after);
      proposed.push({
        ...hostPair,
        section,
        commentPriority,
        // A comment can admit a host whose binding script is unchanged. That
        // scoped exception needs an independent document run before it can
        // create a runtime marker; ordinary direct script causality does not.
        requiresDeterministicConfirmation: commentPriority > 0 && !runtimeVisualCause,
      });
    });
  });
  const selected = selectPrioritizedReviewRuntimeVisualCandidates(
    proposed,
    REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT,
  );
  const candidates: ReviewRuntimeVisualCandidate[] = [];
  selected.forEach(({
    before,
    after,
    section,
    requiresDeterministicConfirmation,
  }) => {
    const beforeBinding = reviewBootstrapElementBinding(beforeDocument, before);
    const afterBinding = reviewBootstrapElementBinding(afterDocument, after);
    if (!beforeBinding || !afterBinding) return;
    const key = `runtime-host-${candidates.length + 1}`;
    const changeId = section.changeId || `runtime-change-${section.outlineId}`;
    bindings.before.push({ ...beforeBinding, key });
    bindings.after.push({ ...afterBinding, key });
    candidates.push({
      key,
      outlineId: section.outlineId,
      changeId,
      label: section.label,
      ...(section.panelKey ? { panelKey: section.panelKey } : {}),
      ...(section.panelPath.length ? { panelPath: [...section.panelPath] } : {}),
      ...(requiresDeterministicConfirmation ? { requiresDeterministicConfirmation } : {}),
    });
  });
  return { candidates, bindings };
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
  scope: ReviewTextChangeScope;
  density: number;
  operation: ReviewTextChangeOperation;
  semanticOwnerId: string;
  geometryOwnerId: string;
  summary?: string;
};

function markTextAnchor(anchor: Element, groupId: string, offset: number) {
  const attribute = "data-pageroot-review-text-anchors";
  const anchors = new Set(
    (anchor.getAttribute(attribute) || "").split(/\s+/).filter(Boolean),
  );
  anchors.add(`${groupId}@${Math.max(0, Math.trunc(offset))}`);
  anchor.setAttribute(attribute, [...anchors].join(" "));
}

function reviewTextAnchorOffset(
  anchor: Element,
  inventory: ReviewTextInventory,
): number {
  const firstEntry = inventory.nodes[0];
  if (!firstEntry) return 0;
  const ownerId = anchor.getAttribute("data-pageroot-review-geometry-owner") || "";
  let offset = 0;
  const walker = anchor.ownerDocument.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    let nestedOwner = parent;
    let crossesOwner = false;
    while (nestedOwner && nestedOwner !== anchor) {
      const nestedOwnerId = nestedOwner.getAttribute("data-pageroot-review-geometry-owner") || "";
      if (nestedOwnerId && nestedOwnerId !== ownerId) {
        crossesOwner = true;
        break;
      }
      nestedOwner = nestedOwner.parentElement;
    }
    const visibleTextNode = Boolean(
      parent
      && !crossesOwner
      && parent.namespaceURI === "http://www.w3.org/1999/xhtml"
      && !parent.closest("script, style, noscript, template, [data-pageroot-review-projection-layer]"),
    );
    if (visibleTextNode) {
      if (node === firstEntry.node) return offset + firstEntry.nodeOffset;
      offset += node.textContent?.length || 0;
    }
    node = walker.nextNode();
  }
  return 0;
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
  marker.dataset.pagerootReviewTextOperation = group.operation;
  marker.dataset.pagerootReviewSemanticOwner = group.semanticOwnerId;
  marker.dataset.pagerootReviewGeometryOwner = group.geometryOwnerId;
  if (group.summary) marker.dataset.pagerootReviewTextSummary = group.summary;
}

function wrapTextRanges(
  inventory: ReviewTextInventory,
  groups: ReviewTextFootprintGroup[],
  tone: "removed" | "added",
) {
  if (!groups.length) return;
  const annotatedRanges = groups.flatMap((group) => (
    mergeReviewTextRanges(group.ranges).map((range) => ({ ...range, group }))
  )).sort((left, right) => left.start - right.start || left.end - right.end);
  inventory.nodes.forEach(({ node, start, end, nodeOffset }) => {
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
      applyTextFootprintMetadata(marker, group);
      marker.textContent = value;
      fragment.append(marker);
    };
    let cursor = 0;
    intersections.forEach((range) => {
      const localStart = nodeOffset + range.start - start;
      const localEnd = nodeOffset + range.end - start;
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
        nodeOffset: entry.nodeOffset + Math.max(0, start - entry.start),
      })),
    breakOffsets: inventory.breakOffsets
      .filter((offset) => offset > start && offset < end)
      .map((offset) => offset - start),
  };
}

const NUMBERED_TEXT_LINE_PATTERN = /^\s*(?:[\u2460-\u2473]|[（(]?\d+[）).、:：]|[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+[）、.]|[•·▪◦●]|[-–—])\s*/u;

const GENERIC_REVIEW_TEXT_CLASSES = new Set([
    "active", "card", "col", "column", "container", "content", "grid", "item",
    "main", "panel", "row", "section", "selected", "wrap", "wrapper",
]);

function sameBreakLayout(before: ReviewTextInventory, after: ReviewTextInventory): boolean {
  return before.breakOffsets.length === after.breakOffsets.length
    && before.breakOffsets.every((offset, index) => offset === after.breakOffsets[index]);
}

type ReviewSemanticUnitKind =
  | "section"
  | "container"
  | "leaf-text-block"
  | "direct-flow"
  | "br-line"
  | "atomic-content"
  | "list"
  | "list-item"
  | "table"
  | "row-group"
  | "table-row"
  | "table-cell";

type ReviewSemanticUnit = {
  kind: ReviewSemanticUnitKind;
  element: Element;
  inventory: ReviewTextInventory | null;
  maximumScope: "inline" | "block";
  children: ReviewSemanticUnit[];
  columnStart?: number;
  columnSpan?: number;
};

type ReviewSemanticPairNode = {
  before: ReviewSemanticUnit | null;
  after: ReviewSemanticUnit | null;
  match: ReviewSemanticAlignmentMatch;
  moved: boolean;
  semanticOwnerId: string;
  geometryOwnerId: string;
  structureFallback: boolean;
  children: ReviewSemanticPairNode[];
};

type ReviewSemanticPairGraph = {
  root: ReviewSemanticPairNode;
};

const REVIEW_LEAF_TEXT_OWNER_TAGS = new Set([
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

const REVIEW_DIRECT_TEXT_OWNER_TAGS = new Set([
  "BUTTON",
  "CAPTION",
  "DD",
  "DIV",
  "DT",
  "FIGCAPTION",
  "LI",
  "TD",
  "TH",
]);

// These elements contribute visible content without contributing to the text
// inventory. They must not be left inside a direct-flow unit: that unit is
// intentionally discarded when it contains neither text nor authored <br>s.
// Foreign-namespace content (notably SVG and MathML) follows the same rule.
const REVIEW_ATOMIC_CONTENT_TAGS = new Set([
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

function isReviewAtomicContentElement(element: Element): boolean {
  return element.namespaceURI !== "http://www.w3.org/1999/xhtml"
    || REVIEW_ATOMIC_CONTENT_TAGS.has(element.tagName);
}

function atomicContentSemanticSignature(element: Element): string | null {
  const identityAttributes = [...element.attributes]
    .filter((attribute) => (
      !VISUAL_ATTRIBUTE_NAMES.has(attribute.name.toLowerCase())
      && !attribute.name.startsWith("data-pageroot-review-")
      && (
        attribute.value.trim().length > 0
        // A present authored data attribute is an intentional, stable
        // identity even when written in HTML boolean form (`data-key`).
        || attribute.name.startsWith("data-")
      )
    ))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => `${attribute.name.toLowerCase()}=${attribute.value}`);
  // A bare tag is not a high-confidence identity. Let repeated or anonymous
  // media remain unmatched rather than guessing that a replacement is a move.
  if (!identityAttributes.length) return null;
  return [
    element.namespaceURI || "",
    element.localName.toLowerCase(),
    ...identityAttributes,
  ].join("\u0000");
}

function atomicContentSemanticUnit(element: Element): ReviewSemanticUnit {
  return {
    kind: "atomic-content",
    element,
    inventory: null,
    maximumScope: "inline",
    children: [],
  };
}

function semanticFlowUnit(
  owner: Element,
  sourceNodes: Node[],
  maximumScope: "inline" | "block",
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
      maximumScope,
      children: [],
    };
  }
  return {
    kind: "direct-flow",
    element: owner,
    inventory: null,
    maximumScope: "inline",
    children: lineRanges.map((range) => ({
      kind: "br-line" as const,
      element: owner,
      inventory: sliceReviewTextInventory(inventory, range.start, range.end),
      maximumScope: "inline" as const,
      children: [],
    })),
  };
}

function semanticChildrenForContainer(container: Element): ReviewSemanticUnit[] {
  const children: ReviewSemanticUnit[] = [];
  let flow: Node[] = [];
  const flush = () => {
    if (!flow.length) return;
    const unit = semanticFlowUnit(
      container,
      flow,
      REVIEW_DIRECT_TEXT_OWNER_TAGS.has(container.tagName) ? "block" : "inline",
    );
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

function tableCellUnits(row: Element): ReviewSemanticUnit[] {
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

function buildReviewSemanticUnit(element: Element): ReviewSemanticUnit {
  if (isReviewAtomicContentElement(element)) return atomicContentSemanticUnit(element);
  if (element.matches("ul, ol")) {
    return {
      kind: "list",
      element,
      inventory: null,
      maximumScope: "inline",
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
      maximumScope: "block",
      children: semanticChildrenForContainer(element),
    };
  }
  if (element.tagName === "TABLE") {
    return {
      kind: "table",
      element,
      inventory: null,
      maximumScope: "inline",
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
      maximumScope: "inline",
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
      maximumScope: "block",
      children: tableCellUnits(element),
    };
  }
  if (element.matches("td, th")) {
    return {
      kind: "table-cell",
      element,
      inventory: null,
      maximumScope: "block",
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
      maximumScope: "block",
      children: [],
    };
  }
  return {
    kind: element.matches("section, article, main, header, footer, nav")
      ? "section"
      : "container",
    element,
    inventory: null,
    maximumScope: "inline",
    children: semanticChildrenForContainer(element),
  };
}

function semanticUnitText(unit: ReviewSemanticUnit): string {
  if (unit.inventory) return unit.inventory.text;
  if (unit.kind === "table-row") {
    return [...unit.element.children]
      .filter((element) => element.matches("th, td"))
      .map((element) => normalizedText(element))
      .join("\u001f");
  }
  return normalizedText(unit.element);
}

function semanticUnitDescriptor(unit: ReviewSemanticUnit, parentKey: string) {
  const logicalCell = unit.kind === "table-cell"
    ? `:${unit.element.tagName}:${unit.columnStart ?? -1}:${unit.columnSpan ?? 1}`
    : `:${unit.element.tagName}`;
  const text = semanticUnitText(unit);
  const numberedPrefix = unit.kind === "br-line"
    ? text.match(NUMBERED_TEXT_LINE_PATTERN)?.[0]?.trim() || ""
    : "";
  const ownsElementIdentity = unit.kind !== "direct-flow" && unit.kind !== "br-line";
  const atomicSignature = unit.kind === "atomic-content"
    ? atomicContentSemanticSignature(unit.element)
    : null;
  return {
    kind: `${unit.kind}${logicalCell}`,
    text,
    stableId: ownsElementIdentity ? pairKey(unit.element) : null,
    exactSignature: atomicSignature
      ? `${unit.kind}\u0000${logicalCell}\u0000${atomicSignature}`
      : text ? `${unit.kind}\u0000${logicalCell}\u0000${text}` : null,
    affinities: [
      ...classTokens(unit.element).filter((token) => !GENERIC_REVIEW_TEXT_CLASSES.has(token)),
      ...(numberedPrefix ? [`number:${numberedPrefix}`] : []),
    ],
    parentKey,
  };
}

function sameLogicalCellPattern(
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

function* buildReviewSemanticPairGraphSteps(
  pair: SectionPair,
): Generator<"semantic-row", ReviewSemanticPairGraph, void> {
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
    moved: boolean,
    inheritedOwnerId?: string,
  ): Generator<"semantic-row", ReviewSemanticPairNode, void> {
    const ownerId = inheritedOwnerId || semanticOwner();
    const node: ReviewSemanticPairNode = {
      before,
      after,
      match,
      moved,
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
          false,
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
        node.children.push(yield* createPair(child, null, "unmatched", false, ownerId));
      }
      for (const child of after.children) {
        node.children.push(yield* createPair(null, child, "unmatched", false, ownerId));
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
      before.children.map((unit) => semanticUnitDescriptor(unit, parentKey)),
      after.children.map((unit) => semanticUnitDescriptor(unit, parentKey)),
    );
    for (const childPair of aligned) {
      node.children.push(yield* createPair(
        childPair.beforeIndex === null ? null : before.children[childPair.beforeIndex],
        childPair.afterIndex === null ? null : after.children[childPair.afterIndex],
        childPair.match,
        childPair.moved,
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
      Boolean(pair.moved),
    ),
  };
}

function flattenReviewSemanticPairs(root: ReviewSemanticPairNode): ReviewSemanticPairNode[] {
  return [root, ...root.children.flatMap(flattenReviewSemanticPairs)];
}

function markSemanticTextFootprintOwner(
  unit: ReviewSemanticUnit,
  groups: ReviewTextFootprintGroup[],
) {
  unit.element.setAttribute(
    "data-pageroot-review-geometry-owner",
    groups[0]?.geometryOwnerId || "",
  );
}

function markStableSentenceRanges(
  unit: ReviewSemanticUnit,
  inventory: ReviewTextInventory,
  evidenceRanges: TextRange[],
) {
  const stableRanges = reviewSentenceRanges(inventory.text).filter((sentence) => (
    !evidenceRanges.some((range) => (
      range.end > sentence.start && range.start < sentence.end
    ))
  ));
  if (!stableRanges.length) return;
  unit.element.setAttribute(
    "data-pageroot-review-stable-text-ranges",
    stableRanges.map((range) => `${range.start}:${range.end}`).join(" "),
  );
}

function markSemanticAllText(
  pair: ReviewSemanticPairNode,
  unit: ReviewSemanticUnit,
  tone: "removed" | "added",
  groupId: string,
): boolean {
  const inventory = unit.inventory;
  if (!inventory?.text.trim()) return false;
  const differences = tone === "added"
    ? { before: [], after: [{ start: 0, end: inventory.text.length }] }
    : { before: [{ start: 0, end: inventory.text.length }], after: [] };
  const plan = readableReviewTextFootprintPlan(
    tone === "added" ? "" : inventory.text,
    tone === "added" ? inventory.text : "",
    differences,
  );
  const side = tone === "added" ? plan.after : plan.before;
  const scope = unit.maximumScope === "inline" ? "inline" : plan.scope;
  const group: ReviewTextFootprintGroup = {
    id: groupId,
    ranges: side.footprintGroups.flat(),
    scope,
    density: plan.density,
    operation: plan.operation,
    semanticOwnerId: pair.semanticOwnerId,
    geometryOwnerId: pair.geometryOwnerId,
  };
  markSemanticTextFootprintOwner(unit, [group]);
  wrapTextRanges(inventory, [group], tone);
  return true;
}

function markSemanticTextDifferences(graph: ReviewSemanticPairGraph): {
  changed: boolean;
} {
  let changed = false;
  let groupSequence = 0;
  flattenReviewSemanticPairs(graph.root).forEach((pair) => {
    const beforeInventory = pair.before?.inventory || null;
    const afterInventory = pair.after?.inventory || null;
    if (!beforeInventory && !afterInventory) return;
    const groupBase = `text-${++groupSequence}`;
    if (!beforeInventory && pair.after) {
      changed = markSemanticAllText(pair, pair.after, "added", `${groupBase}-1`) || changed;
      return;
    }
    if (!afterInventory && pair.before) {
      changed = markSemanticAllText(pair, pair.before, "removed", `${groupBase}-1`) || changed;
      return;
    }
    if (!beforeInventory || !afterInventory || !pair.before || !pair.after) return;
    const layoutChanged = !sameBreakLayout(beforeInventory, afterInventory);
    const differences = beforeInventory.text === afterInventory.text
      ? { before: [], after: [] }
      : sentenceAwareTextDifferences(beforeInventory.text, afterInventory.text);
    const plan = readableReviewTextFootprintPlan(
      beforeInventory.text,
      afterInventory.text,
      { ...differences, layout: layoutChanged },
    );
    if (plan.operation === "none") return;
    if (plan.operation === "layout") {
      return;
    }
    if (plan.operation === "replace") {
      markStableSentenceRanges(pair.before, beforeInventory, plan.before.evidenceRanges);
      markStableSentenceRanges(pair.after, afterInventory, plan.after.evidenceRanges);
    }
    const maximumScope = pair.before.maximumScope === "inline"
      || pair.after.maximumScope === "inline"
      ? "inline"
      : "block";
    const footprintScope = maximumScope === "inline" ? "inline" : plan.scope;
    const preferredSummary = footprintScope === "block" && plan.operation === "replace"
      ? "段落改写"
      : undefined;
    const createGroups = (
      ranges: TextRange[][],
      geometryOwnerId: string,
    ): ReviewTextFootprintGroup[] => ranges.map((groupRanges, index) => ({
      id: `${groupBase}-${index + 1}`,
      ranges: groupRanges,
      scope: footprintScope,
      density: plan.density,
      operation: plan.operation,
      semanticOwnerId: pair.semanticOwnerId,
      geometryOwnerId,
      summary: preferredSummary,
    }));
    const beforeGroups = createGroups(plan.before.footprintGroups, pair.geometryOwnerId);
    const afterGroups = createGroups(plan.after.footprintGroups, pair.geometryOwnerId);
    if (beforeGroups.length) {
      markSemanticTextFootprintOwner(pair.before, beforeGroups);
      wrapTextRanges(beforeInventory, beforeGroups, "removed");
      changed = true;
    } else if (plan.before.anchorOffset !== null) {
      markTextAnchor(
        pair.before.element,
        `${groupBase}-1`,
        reviewTextAnchorOffset(pair.before.element, beforeInventory) + plan.before.anchorOffset,
      );
    }
    if (afterGroups.length) {
      markSemanticTextFootprintOwner(pair.after, afterGroups);
      wrapTextRanges(afterInventory, afterGroups, "added");
      changed = true;
    } else if (plan.after.anchorOffset !== null) {
      markTextAnchor(
        pair.after.element,
        `${groupBase}-1`,
        reviewTextAnchorOffset(pair.after.element, afterInventory) + plan.after.anchorOffset,
      );
    }
  });
  return { changed };
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
  const afterIndexByElement = new Map(
    afterElements.map((element, index) => [element, index]),
  );
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

  const compatibleIdentity = (element: Element) => {
    const identity = pairKey(element);
    return `${element.tagName}\u0000${identity ? `key:${identity}` : "unkeyed"}`;
  };
  const exactMarkupSignature = (element: Element) => (
    `${compatibleIdentity(element)}\u0000${normalizedMarkup(element)}`
  );
  const uniqueBeforeMarkup = uniqueSignatureMap(
    beforeElements.filter((element) => !assignments.has(element)),
    exactMarkupSignature,
  );
  const uniqueAfterMarkup = uniqueSignatureMap(
    afterElements.filter((element) => !usedAfter.has(element)),
    exactMarkupSignature,
  );
  uniqueBeforeMarkup.forEach((beforeElement, signature) => {
    const afterElement = uniqueAfterMarkup.get(signature);
    if (!beforeElement || !afterElement) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });
  const compatibleAfterBuckets = new Map<string, Element[]>();
  afterElements.forEach((afterElement) => {
    if (usedAfter.has(afterElement)) return;
    const key = compatibleIdentity(afterElement);
    const bucket = compatibleAfterBuckets.get(key) ?? [];
    bucket.push(afterElement);
    compatibleAfterBuckets.set(key, bucket);
  });
  const edges = beforeElements.flatMap((beforeElement, beforeIndex) => (
    assignments.has(beforeElement)
      ? []
      : (compatibleAfterBuckets.get(compatibleIdentity(beforeElement)) ?? [])
        .map((afterElement) => ({
        beforeElement,
        afterElement,
        score: elementPairScore(
          beforeElement,
          afterElement,
          beforeIndex,
          afterIndexByElement.get(afterElement) ?? -1,
        ),
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

function markStructureElement(element: Element, tone: string, semanticOwnerId: string) {
  element.setAttribute("data-pageroot-review-structure", tone);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
}

function pairSiblingElements(before: Element[], after: Element[]): Map<Element, Element> {
  const assignments = new Map<Element, Element>();
  const usedAfter = new Set<Element>();
  const compatibleIdentity = (element: Element) => {
    const identity = pairKey(element);
    return `${element.tagName}\u0000${identity ? `key:${identity}` : "unkeyed"}`;
  };
  const exactMarkupSignature = (element: Element) => (
    `${compatibleIdentity(element)}\u0000${normalizedMarkup(element)}`
  );
  const uniqueBeforeMarkup = uniqueSignatureMap(before, exactMarkupSignature);
  const uniqueAfterMarkup = uniqueSignatureMap(after, exactMarkupSignature);
  uniqueBeforeMarkup.forEach((beforeElement, signature) => {
    const afterElement = uniqueAfterMarkup.get(signature);
    if (!beforeElement || !afterElement) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });
  const afterIndexByElement = new Map(
    after.map((element, index) => [element, index]),
  );
  const afterBuckets = new Map<string, Element[]>();
  after.forEach((afterElement) => {
    if (usedAfter.has(afterElement)) return;
    const key = compatibleIdentity(afterElement);
    const bucket = afterBuckets.get(key) ?? [];
    bucket.push(afterElement);
    afterBuckets.set(key, bucket);
  });
  const edges = before.flatMap((beforeElement, beforeIndex) => (
    assignments.has(beforeElement)
      ? []
      : (afterBuckets.get(compatibleIdentity(beforeElement)) ?? [])
        .map((afterElement) => ({
          beforeElement,
          afterElement,
          score: elementPairScore(
            beforeElement,
            afterElement,
            beforeIndex,
            afterIndexByElement.get(afterElement) ?? -1,
          ),
        }))
  )).filter((edge) => Number.isFinite(edge.score))
    .sort((left, right) => right.score - left.score);
  edges.forEach(({ beforeElement, afterElement }) => {
    if (assignments.has(beforeElement) || usedAfter.has(afterElement)) return;
    assignments.set(beforeElement, afterElement);
    usedAfter.add(afterElement);
  });
  return assignments;
}

function markStructureDifferences(graph: ReviewSemanticPairGraph): boolean {
  const stats: StructureDifferenceStats = { added: [], removed: [], moved: [], replaced: [] };
  let inspected = 0;
  const compare = (pair: ReviewSemanticPairNode, depth: number) => {
    if (depth > 12 || inspected >= 800) return;
    inspected += 1;
    const beforeElement = pair.before?.element || null;
    const afterElement = pair.after?.element || null;
    if (!beforeElement && afterElement) {
      markStructureElement(afterElement, "added", pair.semanticOwnerId);
      stats.added.push(semanticElementName(afterElement));
      return;
    }
    if (beforeElement && !afterElement) {
      markStructureElement(beforeElement, "removed", pair.semanticOwnerId);
      stats.removed.push(semanticElementName(beforeElement));
      return;
    }
    if (!beforeElement || !afterElement || !pair.before || !pair.after) return;
    if (pair.moved) {
      markStructureElement(beforeElement, "from", pair.semanticOwnerId);
      markStructureElement(afterElement, "to", pair.semanticOwnerId);
      stats.moved.push(semanticElementName(afterElement));
    }
    if (pair.structureFallback) {
      markStructureElement(beforeElement, "before", pair.semanticOwnerId);
      markStructureElement(afterElement, "after", pair.semanticOwnerId);
      stats.replaced.push(semanticElementName(afterElement));
      return;
    }
    const ownsStructuralElement = pair.before.kind !== "direct-flow"
      && pair.before.kind !== "br-line";
    if (
      ownsStructuralElement
      && structuralSelfSignature(beforeElement) !== structuralSelfSignature(afterElement)
    ) {
      markStructureElement(beforeElement, "before", pair.semanticOwnerId);
      markStructureElement(afterElement, "after", pair.semanticOwnerId);
      stats.replaced.push(semanticElementName(afterElement));
    }
    pair.children.forEach((child) => compare(child, depth + 1));
  };
  compare(graph.root, 0);
  return Object.values(stats).some((entries) => entries.length > 0);
}

const styleDeclarationCache = new Map<string, Map<string, string>>();
const stylesheetRuleCache = new WeakMap<Document, Map<string, string>>();
const changedStylesheetSelectorCache = new WeakMap<
  Document,
  WeakMap<Document, Array<{ selector: string; labels: string[] }>>
>();

function styleDeclarationMap(value: string): Map<string, string> {
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

function stylesheetRules(document: Document): Map<string, string> {
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

function changedStylesheetSelectors(before: Document, after: Document) {
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

type ReviewStyleScope = "box" | "content";

function reviewProjectionFactsForElement(element: Element): ReviewProjectionFact[] {
  return parseReviewProjectionFacts(element.getAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE));
}

function appendProjectionFactToElement(
  element: Element,
  fact: ReviewProjectionFact,
) {
  const facts = appendReviewProjectionFact(reviewProjectionFactsForElement(element), fact);
  element.setAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE, serializeReviewProjectionFacts(facts));
}

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

function semanticStylePairs(graph: ReviewSemanticPairGraph): Array<{
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
      pairSiblingElements(
        inlineElements(pair.before),
        inlineElements(pair.after),
      ).forEach((afterElement, beforeElement) => add(beforeElement, afterElement));
    } else if (pair.children.length === 0) {
      pairVisualElements(pair.before.element, pair.after.element).forEach((visualPair) => {
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

function markStyleDifferences(
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
    if (marked >= 40) break;
  }
  const changedRules = changedStylesheetSelectors(before.ownerDocument, after.ownerDocument);
  changedRules.forEach(({ selector, labels }) => {
    const scope = styleScopeForProperties(labels);
    selector.split(",").forEach((part) => {
      const beforeMatches = new Set(elementsMatchingSelector(before, part));
      const afterMatches = new Set(elementsMatchingSelector(after, part));
      boundedPairs
        .filter((pair) => beforeMatches.has(pair.before) && afterMatches.has(pair.after))
        .slice(0, 40)
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

function semanticLayoutPairs(graph: ReviewSemanticPairGraph): ReviewSemanticPairNode[] {
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

function changeTypesForSemanticGraph(
  graph: ReviewSemanticPairGraph,
): ReviewChangeType[] {
  // Style inspection still runs against the unwrapped source DOM. The same
  // layout planner identifies visual-only pairs first; text marking consumes
  // it again below to avoid fabricating red/green evidence.
  const layoutPairs = semanticLayoutPairs(graph);
  const structureChanged = markStructureDifferences(graph);
  const styleChanged = markStyleDifferences(graph, layoutPairs);
  const textMarking = markSemanticTextDifferences(graph);
  return [
    ...(textMarking.changed ? ["text" as const] : []),
    ...(structureChanged ? ["structure" as const] : []),
    ...(styleChanged ? ["style" as const] : []),
  ];
}

function* annotateChangePairSteps(
  pair: SectionPair,
): Generator<"semantic-row", ReviewChangeType[], void> {
  const graph = yield* buildReviewSemanticPairGraphSteps(pair);
  return changeTypesForSemanticGraph(graph);
}

function attachChangeMarkerMetadata(
  pair: SectionPair,
  changeId: string,
  helper: string,
) {
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    [root, ...root.querySelectorAll("[data-pageroot-review-text-anchors]")]
      .filter((element) => element.hasAttribute("data-pageroot-review-text-anchors"))
      .forEach((element) => {
        element.setAttribute("data-pageroot-review-anchor-change", changeId);
      });
    const markerElements = [root, ...root.querySelectorAll("*")].filter((element) => (
      element.hasAttribute("data-pageroot-review-text")
      || element.hasAttribute("data-pageroot-review-structure")
      || element.hasAttribute("data-pageroot-review-style")
      || element.hasAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE)
    ));
    markerElements.forEach((element, index) => {
      let facts = reviewProjectionFactsForElement(element);
      const textMarker = element.hasAttribute("data-pageroot-review-text");
      const textOperation = element.getAttribute("data-pageroot-review-text-operation");
      const normalizedTextOperation = textOperation === "none"
        || textOperation === "insert"
        || textOperation === "delete"
        || textOperation === "replace"
        || textOperation === "layout"
        ? textOperation
        : null;
      const rawTextScope = element.getAttribute("data-pageroot-review-text-scope");
      const textScope: ReviewTextChangeScope = rawTextScope === "sentence"
        ? "sentence"
        : rawTextScope === "block"
          ? "block"
          : "inline";
      const readableTextSummary = element.getAttribute(
        "data-pageroot-review-text-summary",
      );
      const textSummary = textMarker
        ? readableTextSummary
          || (textOperation === "insert"
            ? "新增内容"
            : textOperation === "delete"
              ? "删除内容"
              : "文本调整")
        : "";
      if (textMarker) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-text-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const textGroup = element.getAttribute("data-pageroot-review-text-group")
          || `text-marker-${index + 1}`;
        facts = appendReviewProjectionFact(facts, {
          id: textGroup,
          type: "text",
          semanticOwnerId,
          ...(geometryOwnerId ? { geometryOwnerId } : {}),
          scope: "text",
          tone: element.getAttribute("data-pageroot-review-text") === "removed"
            ? "removed"
            : "added",
          textGroup,
          textScope,
          textDensity: Number(element.getAttribute("data-pageroot-review-text-density") || 0),
          ...(normalizedTextOperation ? { operation: normalizedTextOperation } : {}),
          summary: textSummary,
        });
      }
      if (element.hasAttribute("data-pageroot-review-structure")) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-structure-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const structureChange = element.getAttribute("data-pageroot-review-structure") || "changed";
        facts = appendReviewProjectionFact(facts, {
          id: `structure-${semanticOwnerId}-${structureChange}`,
          type: "structure",
          semanticOwnerId,
          ...(geometryOwnerId ? { geometryOwnerId } : {}),
          scope: "element",
          structureChange,
          summary: structureChange === "from" || structureChange === "to"
            ? "位置调整"
            : "结构调整",
        });
      }
      const markerTypes = [...new Set(facts.map((fact) => fact.type))] as ReviewChangeType[];
      const textFact = facts.find((fact) => fact.type === "text");
      const visualFact = facts.find((fact) => (
        fact.type === "style" && fact.operation !== "layout"
      ));
      const layoutFact = facts.find((fact) => (
        fact.type === "style" && fact.operation === "layout"
      ));
      const structureFact = facts.find((fact) => fact.type === "structure");
      const summary = textFact?.summary
        || visualFact?.summary
        || layoutFact?.summary
        || structureFact?.summary
        || helper;
      element.setAttribute("data-pageroot-review-marker", changeId);
      element.setAttribute("data-pageroot-review-marker-types", markerTypes.join(" "));
      element.setAttribute("data-pageroot-review-summary", summary);
      element.setAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE, serializeReviewProjectionFacts(facts));
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

function clearReviewCommentScopeAttributes(
  document: Document,
): void {
  document.querySelectorAll(
    `[${REVIEW_COMMENT_KEY_ATTRIBUTE}], [${REVIEW_COMMENT_GLOBAL_ATTRIBUTE}]`,
  ).forEach((element) => {
    element.removeAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE);
    element.removeAttribute(REVIEW_COMMENT_GLOBAL_ATTRIBUTE);
  });
}

function reviewCommentBootstrapBindings(
  document: Document,
  reviewCommentTargets: readonly ReviewCommentTarget[],
): ReviewCommentBootstrapBinding[] {
  const sourceNodeIdsByKey = new Map(
    reviewCommentTargets.flatMap((target) => (
      target.sourceNodeId ? [[target.key, target.sourceNodeId] as const] : []
    )),
  );
  const bindings: ReviewCommentBootstrapBinding[] = [];
  const seenSourceNodeIds = new Set<string>();
  document.querySelectorAll(`[${REVIEW_COMMENT_KEY_ATTRIBUTE}]`).forEach((element) => {
    const key = element.getAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE) || "";
    const sourceNodeId = sourceNodeIdsByKey.get(key);
    if (!sourceNodeId || seenSourceNodeIds.has(sourceNodeId)) return;
    const binding = reviewBootstrapElementBinding(document, element, true);
    if (!binding) return;
    seenSourceNodeIds.add(sourceNodeId);
    bindings.push({ ...binding, sourceNodeId });
  });
  return bindings;
}

function durableReviewCommentTargetSelector(
  document: Document,
  sourceIndex: ReturnType<typeof buildSourceIndex>,
  element: Element,
  target: HtmlCanvasSelection,
): string | null {
  const sourceElement = resolveReviewCommentSourceElement(sourceIndex, target);
  const selector = sourceElement?.selector || "";
  // A positional selector can drift when authored code inserts, removes or
  // reorders same-tag siblings. A source-index selector is durable only when
  // it is rooted in the target's unique id, data attribute, name or aria label.
  if (
    !selector
    || /:nth-(?:child|of-type)\(/iu.test(selector)
    || !(
      selector.startsWith("#")
      || /\[\s*(?:data-[\w-]+|name|aria-label)\s*=/iu.test(selector)
    )
  ) return null;
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element ? selector : null;
  } catch {
    return null;
  }
}

function annotateReviewComments(
  document: Document,
  sourceHtml: string,
  comments: readonly CommentItem[],
  indexedSource?: ReturnType<typeof buildSourceIndex> | null,
): ReviewCommentAnnotations {
  if (!comments.length || !document.body) return { groups: [], targets: [] };
  let sourceIndex = indexedSource ?? null;
  try {
    sourceIndex ??= buildSourceIndex(sourceHtml);
  } catch {
    return { groups: [], targets: [] };
  }
  const sourceElementsByNodeId = new Map<string, Element>();
  const sourceNodeIdsByElement = new Map<Element, string>();
  document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    const nodeId = element.getAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    if (nodeId && !sourceElementsByNodeId.has(nodeId)) {
      sourceElementsByNodeId.set(nodeId, element);
      sourceNodeIdsByElement.set(element, nodeId);
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
  if (!groups.size) return { groups: [], targets: [] };

  const targets: ReviewCommentTarget[] = [];
  const reviewGroups = [...groups.entries()].map(([element, items], index) => {
    const key = `review-comment-${index + 1}`;
    const global = element === document.body;
    element.setAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE, key);
    if (global) {
      element.setAttribute(REVIEW_COMMENT_GLOBAL_ATTRIBUTE, "true");
    }
    const selector = global
      ? "body"
      : items.reduce<string | null>(
        (matched, item) => matched || durableReviewCommentTargetSelector(
          document,
          sourceIndex,
          element,
          item.target,
        ),
        null,
      );
    const sourceNodeId = global ? undefined : sourceNodeIdsByElement.get(element);
    if (selector || sourceNodeId) {
      targets.push({
        key,
        global,
        ...(selector ? { selector } : {}),
        ...(sourceNodeId ? { sourceNodeId } : {}),
      });
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
  return { groups: reviewGroups, targets };
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
  sourceSha256: string,
  runtimeVisualBindings: readonly ReviewRuntimeVisualBootstrapBinding[] = [],
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
): string {
  const runtimeVisualCandidateKeys = runtimeVisualBindings.map(({ key }) => key);
  const serializedBootstrapPayload = (value: unknown) => (
    JSON.stringify(value).replace(/</gu, "\\u003c")
  );
  return String.raw`
(() => {
  const runtimeVisualContractVersion = ${RUNTIME_VISUAL_CONTRACT_VERSION};
  const sessionId = ${JSON.stringify(sessionId)};
  const side = ${JSON.stringify(side)};
  const sourceSha256 = ${JSON.stringify(sourceSha256)};
  // This first managed script binds evidence readers before authored scripts execute.
  const runtimeVisualExpectedKeys = Object.freeze(
    ${JSON.stringify([...runtimeVisualCandidateKeys])},
  );
  const runtimeVisualInitialBindings = Object.freeze(
    ${serializedBootstrapPayload(runtimeVisualBindings)},
  );
  const reviewCommentInitialBindings = Object.freeze(
    ${serializedBootstrapPayload(reviewCommentBindings)},
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
  const RuntimeVisualNumber = Number;
  const RuntimeVisualPromise = Promise;
  const runtimeVisualMathImul = Math.imul.bind(Math);
  const runtimeVisualMathFloor = Math.floor.bind(Math);
  const runtimeVisualMathRound = Math.round.bind(Math);
  const runtimeVisualMathMax = Math.max.bind(Math);
  const runtimeVisualParseFloat = Number.parseFloat.bind(Number);
  const runtimeVisualNumberIsFinite = Number.isFinite.bind(Number);
  const runtimeVisualSetTimeout = window.setTimeout.bind(window);
  const runtimeVisualRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const runtimeVisualPromiseResolve = RuntimeVisualPromise.resolve.bind(RuntimeVisualPromise);
  const runtimeVisualPromiseThen = runtimeVisualBindCall(RuntimeVisualPromise.prototype.then);
  const runtimeVisualPromiseRace = (values) => new RuntimeVisualPromise((resolve, reject) => {
    for (let index = 0; index < values.length; index += 1) {
      runtimeVisualPromiseThen(runtimeVisualPromiseResolve(values[index]), resolve, reject);
    }
  });
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
  const runtimeVisualStringToLowerCase = runtimeVisualBindCall(String.prototype.toLowerCase);
  const runtimeVisualStringTrim = runtimeVisualBindCall(String.prototype.trim);
  const runtimeVisualStringFromCharCode = String.fromCharCode.bind(String);
  const runtimeVisualNumberToString = runtimeVisualBindCall(Number.prototype.toString);
  const runtimeVisualStringPadStart = runtimeVisualBindCall(String.prototype.padStart);
  const runtimeVisualRegExpTest = runtimeVisualBindCall(RegExp.prototype.test);
  const runtimeVisualRegExpExec = runtimeVisualBindCall(RegExp.prototype.exec);
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
  const runtimeVisualElementQuerySelectorAll = runtimeVisualBindCall(
    Element.prototype.querySelectorAll,
  );
  const runtimeVisualElementGetBoundingClientRect = runtimeVisualBindCall(
    Element.prototype.getBoundingClientRect,
  );
  const runtimeVisualElementGetClientRects = runtimeVisualBindCall(
    Element.prototype.getClientRects,
  );
  const runtimeVisualNodeParentElement = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "parentElement").get,
  );
  const runtimeVisualDocumentReadyState = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Document.prototype, "readyState").get,
  );
  const runtimeVisualNodeIsConnected = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "isConnected").get,
  );
  const runtimeVisualNodeTextContent = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "textContent").get,
  );
  const runtimeVisualElementTagName = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get,
  );
  const runtimeVisualElementChildren = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "children").get,
  );
  const runtimeVisualHtmlCollectionLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCollection.prototype, "length").get,
  );
  const runtimeVisualHtmlCollectionItem = runtimeVisualBindCall(
    HTMLCollection.prototype.item,
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
  const runtimeVisualMutationObserverDisconnect = runtimeVisualBindCall(
    MutationObserver.prototype.disconnect,
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
  const reviewParent = parent;
  const postToParent = reviewParent.postMessage.bind(reviewParent);
  const runtimeVisualAddEventListener = addEventListener.bind(window);
  const runtimeVisualChannel = typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  // The comment locator capability is deliberately separate from runtime
  // evidence. It exists only on the before side and never appears in this
  // bootstrap source or in authored-page markup.
  const reviewCommentChannel = side === "before" && typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  const postRuntimeVisualPort = runtimeVisualChannel
    ? runtimeVisualChannel.port1.postMessage.bind(runtimeVisualChannel.port1)
    : null;
  const stopImmediateMessagePropagation = Function.prototype.call.bind(
    Event.prototype.stopImmediatePropagation,
  );
  let runtimeVisualChannelTransferred = false;
  let reviewCommentChannelTransferred = false;
  let runtimeVisualSnapshotBatch = null;
  let reviewCommentTargets = [];
  let pendingRuntimeVisualChannelChallenge = null;
  let pendingReviewCommentChannelChallenge = null;
  let privateChannelRequestsReady = false;
  const capturePrivateChannelRequest = (event) => {
    const message = event.data;
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "pageroot-ai-review-parent"
      || message.sessionId !== sessionId
      || (
        message.type !== "request-runtime-visual-channel"
        && message.type !== "request-review-comment-channel"
      )
      || (
        message.type === "request-runtime-visual-channel"
        && (
          message.contractVersion !== runtimeVisualContractVersion
          || message.sourceSha256 !== sourceSha256
        )
      )
    ) return;
    // This listener is installed by the first owned script with capture=true.
    // It consumes the capability challenge before authored capture listeners can
    // observe it or race a forged port back to the parent.
    stopImmediateMessagePropagation(event);
    if (message.type === "request-runtime-visual-channel") {
      pendingRuntimeVisualChannelChallenge = message.challenge;
    } else {
      pendingReviewCommentChannelChallenge = message.challenge;
    }
    if (privateChannelRequestsReady) drainPrivateChannelRequests();
  };
  runtimeVisualAddEventListener("message", capturePrivateChannelRequest, { capture: true });
  const post = (type, extra = {}) => postToParent({
    source: "pageroot-ai-review",
    contractVersion: runtimeVisualContractVersion,
    sessionId,
    side,
    sourceSha256,
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
      contractVersion: runtimeVisualContractVersion,
      sessionId,
      side,
      sourceSha256,
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
      contractVersion: runtimeVisualContractVersion,
      sessionId,
      side,
      sourceSha256,
      type: "runtime-visual-channel",
      challenge,
    }, "*", [runtimeVisualChannel.port2]);
    publishRuntimeVisualSnapshots();
    post("ready", {
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    });
  };
  const transferReviewCommentChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (!/^[a-f0-9]{32}$/u.test(challenge)) return;
    if (!reviewCommentChannel || reviewCommentChannelTransferred) return;
    reviewCommentChannelTransferred = true;
    postToParent({
      source: "pageroot-ai-review",
      contractVersion: runtimeVisualContractVersion,
      sessionId,
      side,
      sourceSha256,
      type: "review-comment-channel",
      challenge,
    }, "*", [reviewCommentChannel.port2]);
  };
  const drainPrivateChannelRequests = () => {
    const runtimeChallenge = pendingRuntimeVisualChannelChallenge;
    const commentChallenge = pendingReviewCommentChannelChallenge;
    pendingRuntimeVisualChannelChallenge = null;
    pendingReviewCommentChannelChallenge = null;
    if (runtimeChallenge !== null) transferRuntimeVisualChannel(runtimeChallenge);
    if (commentChallenge !== null) transferReviewCommentChannel(commentChallenge);
  };
  privateChannelRequestsReady = true;
  drainPrivateChannelRequests();
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
  const runtimeVisualSourceBoxAttributes = ${JSON.stringify(REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES)};
  const runtimeVisualCandidateLimit = ${REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT};
  const runtimeVisualIdentityAttributeLimit = ${RUNTIME_VISUAL_CONTRACT.identityAttributeLimit};
  const runtimeVisualAtomLimit = ${RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms};
  const runtimeVisualBatchAtomLimit = ${RUNTIME_VISUAL_CONTRACT.pageBudget.atoms};
  const runtimeVisualBatchNodeLimit = ${RUNTIME_VISUAL_CONTRACT.pageBudget.nodes};
  const runtimeVisualCanvasPixelLimit = ${RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels};
  const runtimeVisualValueLimit = ${RUNTIME_VISUAL_CONTRACT.pageBudget.hostValueLength};
  const runtimeVisualBatchValueLimit = ${RUNTIME_VISUAL_CONTRACT.pageBudget.valueLength};
  const runtimeVisualSnapshotBudgetExhausted = (budget) => (
    budget.atoms >= runtimeVisualBatchAtomLimit
    || budget.nodes >= runtimeVisualBatchNodeLimit
    || budget.valueLength >= runtimeVisualBatchValueLimit
    || budget.canvasPixels >= runtimeVisualCanvasPixelLimit
  );
  const runtimeVisualIdentityElements = new RuntimeVisualMap();
  const runtimeVisualHostKeys = new RuntimeVisualMap();
  const runtimeVisualSourceBoxSignatures = new RuntimeVisualMap();
  const runtimeVisualInvalidKeys = new RuntimeVisualSet();
  const reviewCommentSourceNodeIdPattern = /^element:\d+:\d+:[a-z][a-z0-9:-]{0,127}$/iu;
  const reviewCommentIdentityElements = new RuntimeVisualMap();
  const reviewCommentDeferredBindings = new RuntimeVisualMap();
  const reviewCommentInvalidSourceNodeIds = new RuntimeVisualSet();
  const runtimeVisualIdentityKey = (value) => {
    const key = safeKey(value);
    return runtimeVisualSetHas(runtimeVisualExpectedKeySet, key) ? key : "";
  };
  const safeReviewCommentSourceNodeId = (value) => {
    const sourceNodeId = RuntimeVisualString(value || "");
    return sourceNodeId.length <= 256
      && runtimeVisualRegExpTest(reviewCommentSourceNodeIdPattern, sourceNodeId)
      ? sourceNodeId
      : "";
  };
  const runtimeVisualSourceBoxSignature = (host) => runtimeVisualStringify(
    runtimeVisualArrayMap(
      runtimeVisualSourceBoxAttributes,
      (attribute) => [attribute, runtimeVisualElementGetAttribute(host, attribute)],
    ),
  );
  const runtimeVisualDocumentRoot = document.documentElement;
  const runtimeVisualInitialBindingPath = (value) => {
    if (!runtimeVisualArrayIsArray(value) || value.length > 256) return null;
    const path = [];
    for (let index = 0; index < value.length; index += 1) {
      const part = value[index];
      if (
        typeof part !== "number"
        || part < 0
        || part > 1000000
        || runtimeVisualMathFloor(part) !== part
      ) return null;
      runtimeVisualArrayPush(path, part);
    }
    return path;
  };
  const runtimeVisualInitialBindingPathElement = (rawPath) => {
    const path = runtimeVisualInitialBindingPath(rawPath);
    if (!path || !runtimeVisualIsInstance(RuntimeVisualElement, runtimeVisualDocumentRoot)) {
      return null;
    }
    let element = runtimeVisualDocumentRoot;
    for (let index = 0; index < path.length; index += 1) {
      const children = runtimeVisualElementChildren(element);
      const childIndex = path[index];
      if (childIndex >= runtimeVisualHtmlCollectionLength(children)) return null;
      const child = runtimeVisualHtmlCollectionItem(children, childIndex);
      if (!runtimeVisualIsInstance(RuntimeVisualElement, child)) return null;
      element = child;
    }
    return element;
  };
  const runtimeVisualInitialBindingPathMatches = (element, binding) => (
    runtimeVisualInitialBindingPathElement(binding?.path) === element
  );
  const runtimeVisualInitialBindingIdentityAttributes = (binding) => {
    const runtimeVisualBindingAttributeNamePattern = /^[a-z_:][a-z0-9:._-]{0,127}$/iu;
    const runtimeVisualOwnedAttributeNamePattern = /^data-pageroot-/iu;
    const rawAttributes = binding?.identityAttributes;
    if (
      !runtimeVisualArrayIsArray(rawAttributes)
      || rawAttributes.length > runtimeVisualIdentityAttributeLimit
    ) return null;
    const attributes = [];
    for (let index = 0; index < rawAttributes.length; index += 1) {
      const rawAttribute = rawAttributes[index];
      if (!runtimeVisualArrayIsArray(rawAttribute) || rawAttribute.length !== 2) return null;
      const name = RuntimeVisualString(rawAttribute[0] || "");
      const value = RuntimeVisualString(rawAttribute[1] || "");
      if (
        !runtimeVisualRegExpTest(runtimeVisualBindingAttributeNamePattern, name)
        || runtimeVisualRegExpTest(runtimeVisualOwnedAttributeNamePattern, name)
        || value.length > 1024
      ) return null;
      runtimeVisualArrayPush(attributes, [name, value]);
    }
    return attributes;
  };
  const runtimeVisualInitialBindingIgnoresIdentityText = (
    identityAttributes,
    identityText,
  ) => {
    if (!identityText) return true;
    if (!identityAttributes?.length) return false;
    // A class-only fingerprint is intentionally text-sensitive. Class names
    // are commonly shared by sibling comment targets, so dropping the frozen
    // text would make the final uniqueness pass bind an arbitrary sibling.
    return !identityAttributes.every(([name]) => (
      runtimeVisualStringToLowerCase(RuntimeVisualString(name)) === "class"
    ));
  };
  const runtimeVisualInitialBindingMatches = (
    element,
    binding,
    ignoreIdentityText = false,
  ) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return false;
    const tagName = RuntimeVisualString(binding?.tagName || "");
    const sourceBoxSignature = RuntimeVisualString(binding?.sourceBoxSignature || "");
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (
      !(
        tagName.length > 0
        && tagName.length <= 128
        && sourceBoxSignature.length > 0
        && sourceBoxSignature.length <= 4096
        && identityAttributes !== null
        && identityText.length <= 1024
        && runtimeVisualElementTagName(element) === tagName
      )
    ) return false;
    for (let index = 0; index < identityAttributes.length; index += 1) {
      const [name, value] = identityAttributes[index];
      if (runtimeVisualElementGetAttribute(element, name) !== value) return false;
    }
    return ignoreIdentityText
      || !identityText
      || runtimeVisualNormalizeText(runtimeVisualNodeTextContent(element) || "")
        .slice(0, 1024) === identityText;
  };
  const runtimeVisualObservedBindingMatches = (element, binding) => {
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (!runtimeVisualInitialBindingPathMatches(element, binding)) return false;
    if (!identityAttributes?.length && identityText.length > 0) {
      return runtimeVisualInitialBindingMatches(element, binding, false);
    }
    return runtimeVisualInitialBindingMatches(
      element,
      binding,
      runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
    );
  };
  const runtimeVisualInitialBindingHasFingerprint = (binding) => {
    const attributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    return Boolean(
      attributes?.length
      || (typeof binding?.identityText === "string" && binding.identityText.length),
    );
  };
  const runtimeVisualInitialBindingSourceBoxMatches = (element, binding) => (
    RuntimeVisualString(binding?.sourceBoxSignature || "")
      === runtimeVisualSourceBoxSignature(element)
  );
  const runtimeVisualInitialBindingForPath = (element, binding) => {
    let matchingBinding = null;
    runtimeVisualArrayForEach(runtimeVisualInitialBindings, (candidate) => {
      if (
        matchingBinding
        || candidate === binding
        || !runtimeVisualIdentityKey(candidate?.key)
        || !runtimeVisualInitialBindingPathMatches(element, candidate)
      ) return;
      matchingBinding = candidate;
    });
    return matchingBinding;
  };
  const reviewCommentInitialBindingForPath = (element, binding) => {
    let matchingBinding = null;
    runtimeVisualArrayForEach(reviewCommentInitialBindings, (candidate) => {
      if (
        matchingBinding
        || candidate === binding
        || !safeReviewCommentSourceNodeId(candidate?.sourceNodeId)
        || !runtimeVisualInitialBindingPathMatches(element, candidate)
      ) return;
      matchingBinding = candidate;
    });
    return matchingBinding;
  };
  const runtimeVisualInitialBindingElement = (binding, useFrozenPath = true) => {
    const pathElement = runtimeVisualInitialBindingPathElement(binding?.path);
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (useFrozenPath && runtimeVisualInitialBindingMatches(
      pathElement,
      binding,
      runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
    )) return pathElement;
    if (runtimeVisualDocumentReadyState(document) === "loading") return null;
    if (!runtimeVisualInitialBindingHasFingerprint(binding)) return null;
    const matching = [];
    runtimeVisualArrayForEach(runtimeVisualQueryElements("*"), (element) => {
      if (
        matching.length < 2
        && runtimeVisualInitialBindingMatches(
          element,
          binding,
          runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
        )
      ) runtimeVisualArrayPush(matching, element);
    });
    return matching.length === 1 ? matching[0] : null;
  };
  const captureRuntimeVisualInitialBinding = (binding, observedElement = null) => {
    const key = runtimeVisualIdentityKey(binding?.key);
    if (!key || runtimeVisualSetHas(runtimeVisualInvalidKeys, key)) return;
    if (observedElement !== null) {
      const pathMatches = runtimeVisualInitialBindingPathMatches(
        observedElement,
        binding,
      );
      const hasFingerprint = runtimeVisualInitialBindingHasFingerprint(binding);
      if (
        pathMatches
        && !hasFingerprint
        && runtimeVisualInitialBindingMatches(observedElement, binding, true)
      ) {
        const existing = runtimeVisualMapGet(runtimeVisualIdentityElements, key);
        const existingKey = runtimeVisualMapGet(runtimeVisualHostKeys, observedElement);
        if ((existing && existing !== observedElement) || (existingKey && existingKey !== key)) {
          runtimeVisualSetAdd(runtimeVisualInvalidKeys, key);
          if (existingKey) runtimeVisualSetAdd(runtimeVisualInvalidKeys, existingKey);
          return;
        }
        if (!existing && !existingKey) {
          runtimeVisualMapSet(runtimeVisualIdentityElements, key, observedElement);
          runtimeVisualMapSet(runtimeVisualHostKeys, observedElement, key);
          runtimeVisualMapSet(
            runtimeVisualSourceBoxSignatures,
            observedElement,
            RuntimeVisualString(binding.sourceBoxSignature),
          );
        }
        return;
      }
      // A fingerprintless runtime host has no evidence with which to
      // distinguish a same-tag parser decoy from the source target after the
      // frozen path shifts. Keep the entire runtime binding unavailable rather
      // than letting the first observed element fabricate a visual diff.
      if (
        !pathMatches
        && !hasFingerprint
        && runtimeVisualInitialBindingMatches(observedElement, binding, true)
        && runtimeVisualInitialBindingSourceBoxMatches(observedElement, binding)
      ) {
        // A legitimate sibling can have the same tag and source-box
        // attributes. Its observation belongs to the other declared frozen
        // path, not to this binding's decoy check.
        if (runtimeVisualInitialBindingForPath(observedElement, binding)) return;
        runtimeVisualSetAdd(runtimeVisualInvalidKeys, key);
        return;
      }
      if (!runtimeVisualObservedBindingMatches(observedElement, binding)) return;
    }
    const element = observedElement || runtimeVisualInitialBindingElement(binding);
    if (!element) return;
    const existing = runtimeVisualMapGet(runtimeVisualIdentityElements, key);
    const existingKey = runtimeVisualMapGet(runtimeVisualHostKeys, element);
    if (
      (existing && existing !== element)
      || (existingKey && existingKey !== key)
    ) {
      runtimeVisualSetAdd(runtimeVisualInvalidKeys, key);
      if (existingKey) runtimeVisualSetAdd(runtimeVisualInvalidKeys, existingKey);
      return;
    }
    if (!existing && !existingKey) {
      runtimeVisualMapSet(runtimeVisualIdentityElements, key, element);
      runtimeVisualMapSet(runtimeVisualHostKeys, element, key);
      runtimeVisualMapSet(
        runtimeVisualSourceBoxSignatures,
        element,
        RuntimeVisualString(binding.sourceBoxSignature),
      );
    }
  };
  const captureReviewCommentInitialBinding = (binding, observedElement = null) => {
    const sourceNodeId = safeReviewCommentSourceNodeId(binding?.sourceNodeId);
    if (
      !sourceNodeId
      || runtimeVisualSetHas(reviewCommentInvalidSourceNodeIds, sourceNodeId)
    ) return;
    if (observedElement !== null) {
      const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
      const identityText = typeof binding?.identityText === "string"
        ? RuntimeVisualString(binding.identityText)
        : "";
      const pathMatches = runtimeVisualInitialBindingPathMatches(
        observedElement,
        binding,
      );
      const hasFingerprint = runtimeVisualInitialBindingHasFingerprint(binding);
      if (
        pathMatches
        && !hasFingerprint
        && runtimeVisualInitialBindingMatches(observedElement, binding, true)
      ) {
        const existing = runtimeVisualMapGet(reviewCommentIdentityElements, sourceNodeId);
        if (existing && existing !== observedElement) {
          runtimeVisualSetAdd(reviewCommentInvalidSourceNodeIds, sourceNodeId);
          return;
        }
        if (!existing) {
          runtimeVisualMapSet(reviewCommentIdentityElements, sourceNodeId, observedElement);
        }
        return;
      }
      // A path-only binding has no evidence with which to distinguish a
      // same-tag parser decoy from the source target after the frozen path
      // shifts. Keep the entire comment binding unavailable rather than
      // allowing the first observed element to become a guessed TargetRef.
      if (
        !pathMatches
        && !hasFingerprint
        && runtimeVisualInitialBindingMatches(observedElement, binding, true)
        && runtimeVisualInitialBindingSourceBoxMatches(observedElement, binding)
      ) {
        // A legitimate sibling can have the same tag and source-box
        // attributes. Its observation belongs to the other declared frozen
        // path, not to this binding's decoy check.
        if (reviewCommentInitialBindingForPath(observedElement, binding)) return;
        runtimeVisualSetAdd(reviewCommentInvalidSourceNodeIds, sourceNodeId);
        return;
      }
      if (!runtimeVisualInitialBindingMatches(
        observedElement,
        binding,
        runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
      )) return;
      runtimeVisualMapSet(reviewCommentDeferredBindings, binding, true);
      return;
    }
    const element = runtimeVisualInitialBindingElement(
      binding,
      !runtimeVisualMapHas(reviewCommentDeferredBindings, binding),
    );
    if (!element) return;
    const existing = runtimeVisualMapGet(reviewCommentIdentityElements, sourceNodeId);
    if (existing && existing !== element) {
      runtimeVisualSetAdd(reviewCommentInvalidSourceNodeIds, sourceNodeId);
      return;
    }
    if (!existing) runtimeVisualMapSet(reviewCommentIdentityElements, sourceNodeId, element);
  };
  let runtimeVisualInitialBindingsBootstrapped = false;
  let runtimeVisualInitialBindingsClosed = false;
  const captureInitialBindings = (records = []) => {
    if (runtimeVisualInitialBindingsClosed) return;
    if (!runtimeVisualInitialBindingsBootstrapped) {
      runtimeVisualInitialBindingsBootstrapped = true;
      runtimeVisualArrayForEach(
        runtimeVisualInitialBindings,
        captureRuntimeVisualInitialBinding,
      );
      runtimeVisualArrayForEach(
        reviewCommentInitialBindings,
        captureReviewCommentInitialBinding,
      );
    }
    runtimeVisualArrayForEach(records, (record) => {
      if (runtimeVisualMutationRecordType(record) !== "childList") return;
      const addedNodes = runtimeVisualMutationRecordAddedNodes(record);
      const addedNodeCount = runtimeVisualNodeListLength(addedNodes);
      for (let nodeIndex = 0; nodeIndex < addedNodeCount; nodeIndex += 1) {
        const addedNode = runtimeVisualNodeListItem(addedNodes, nodeIndex);
        if (!runtimeVisualIsInstance(RuntimeVisualElement, addedNode)) continue;
        const addedElements = [addedNode];
        runtimeVisualArrayForEach(
          runtimeVisualElementQuerySelectorAll(addedNode, "*"),
          (element) => runtimeVisualArrayPush(addedElements, element),
        );
        runtimeVisualArrayForEach(addedElements, (element) => {
          runtimeVisualArrayForEach(
            runtimeVisualInitialBindings,
            (binding) => captureRuntimeVisualInitialBinding(binding, element),
          );
          runtimeVisualArrayForEach(
            reviewCommentInitialBindings,
            (binding) => captureReviewCommentInitialBinding(binding, element),
          );
        });
      }
    });
  };
  const initialBindingObserver = (
    runtimeVisualInitialBindings.length || reviewCommentInitialBindings.length
  )
    ? new RuntimeVisualMutationObserver(captureInitialBindings)
    : null;
  if (initialBindingObserver && runtimeVisualDocumentRoot) {
    captureInitialBindings();
    runtimeVisualMutationObserverObserve(
      initialBindingObserver,
      runtimeVisualDocumentRoot,
      { subtree: true, childList: true },
    );
  }
  const drainInitialBindings = () => {
    if (!initialBindingObserver || runtimeVisualInitialBindingsClosed) return;
    captureInitialBindings(runtimeVisualMutationObserverTakeRecords(initialBindingObserver));
  };
  const closeInitialBindings = () => {
    if (!initialBindingObserver || runtimeVisualInitialBindingsClosed) return;
    drainInitialBindings();
    runtimeVisualArrayForEach(
      reviewCommentInitialBindings,
      (binding) => {
        if (runtimeVisualMapHas(reviewCommentDeferredBindings, binding)) {
          captureReviewCommentInitialBinding(binding);
        }
      },
    );
    runtimeVisualMutationObserverDisconnect(initialBindingObserver);
    runtimeVisualInitialBindingsClosed = true;
  };
  const runtimeVisualDelay = (milliseconds) => new RuntimeVisualPromise((resolve) => {
    runtimeVisualSetTimeout(resolve, milliseconds);
  });
  const runtimeVisualFrames = () => new RuntimeVisualPromise((resolve) => {
    runtimeVisualRequestAnimationFrame(() => runtimeVisualRequestAnimationFrame(resolve));
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
      first = runtimeVisualMathImul(first ^ code, 16777619);
      second = runtimeVisualMathImul(second ^ code, 3266489917);
      third = runtimeVisualMathImul(third ^ code, 668265263);
      fourth = runtimeVisualMathImul(fourth ^ code, 374761393);
    }
    return runtimeVisualHex(first)
      + runtimeVisualHex(second)
      + runtimeVisualHex(third)
      + runtimeVisualHex(fourth)
      + ":" + runtimeVisualMathMax(1, textValue.length);
  };
  const runtimeVisualByteDigest = (bytes) => {
    let first = 2166136261;
    let second = 2246822507;
    let third = 3266489909;
    let fourth = 668265263;
    for (let index = 0; index < bytes.length; index += 1) {
      const value = bytes[index];
      first = runtimeVisualMathImul(first ^ value, 16777619);
      second = runtimeVisualMathImul(second ^ value, 3266489917);
      third = runtimeVisualMathImul(third ^ value, 668265263);
      fourth = runtimeVisualMathImul(fourth ^ value, 374761393);
    }
    return runtimeVisualHex(first)
      + runtimeVisualHex(second)
      + runtimeVisualHex(third)
      + runtimeVisualHex(fourth)
      + ":" + runtimeVisualMathMax(1, bytes.length);
  };
  const runtimeVisualRounded = (value) => (
    runtimeVisualMathRound(RuntimeVisualNumber(value || 0) * 2) / 2
  );
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
        || RuntimeVisualNumber(runtimeVisualStyleValue(style, "opacity") || 1) <= 0
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
  const runtimeVisualNormalizedPaintValue = (value) => (
    runtimeVisualStringToLowerCase(
      runtimeVisualStringTrim(RuntimeVisualString(value || "")),
    )
  );
  const runtimeVisualTransparent = (value) => {
    const normalized = runtimeVisualNormalizedPaintValue(value);
    if (!normalized || normalized === "transparent") return true;
    const alphaMatch = runtimeVisualRegExpExec(
      /^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+%?)\s*\)$/iu,
      normalized,
    ) || runtimeVisualRegExpExec(
      /^rgba?\([^/]*\/\s*([0-9.]+%?)\s*\)$/iu,
      normalized,
    ) || runtimeVisualRegExpExec(
      /^(?:color|lab|lch|oklab|oklch|hsl|hwb)\([^/]*\/\s*([0-9.]+%?)\s*\)$/iu,
      normalized,
    );
    if (alphaMatch) {
      const alpha = runtimeVisualParseFloat(alphaMatch[1]);
      if (runtimeVisualNumberIsFinite(alpha) && alpha <= 0) return true;
    }
    return Boolean(runtimeVisualRegExpExec(
      /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/iu,
      normalized,
    ));
  };
  const runtimeVisualShadowHasPaint = (value) => {
    const normalized = runtimeVisualNormalizedPaintValue(value);
    if (!normalized || normalized === "none") return false;
    const colorPattern = /(?:(?:rgba?|color|lab|lch|oklab|oklch|hsl|hwb)\([^)]*\)|#[0-9a-f]{3,8}|transparent)/giu;
    const colors = [];
    let colorMatch = runtimeVisualRegExpExec(colorPattern, normalized);
    while (colorMatch) {
      runtimeVisualArrayPush(colors, colorMatch[0]);
      colorMatch = runtimeVisualRegExpExec(colorPattern, normalized);
    }
    return !colors.length
      || runtimeVisualArraySome(colors, (color) => !runtimeVisualTransparent(color));
  };
  const runtimeVisualTextEffectiveColor = (style) => (
    runtimeVisualStyleValue(style, "-webkit-text-fill-color")
      || runtimeVisualStyleValue(style, "color")
  );
  const runtimeVisualTextPaint = (style) => [
    runtimeVisualTextEffectiveColor(style),
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
    runtimeVisualStyleValue(style, "-webkit-text-stroke-color"),
    runtimeVisualStyleValue(style, "-webkit-text-stroke-width"),
  ];
  const runtimeVisualTextHasPaint = (style) => {
    const textShadow = runtimeVisualStyleValue(style, "text-shadow");
    const decorationLine = runtimeVisualStyleValue(style, "text-decoration-line");
    const decorationColor = runtimeVisualStyleValue(style, "text-decoration-color");
    const strokeWidth = runtimeVisualParseFloat(
      runtimeVisualStyleValue(style, "-webkit-text-stroke-width") || "0",
    );
    const strokeColor = runtimeVisualStyleValue(style, "-webkit-text-stroke-color");
    return (
      !runtimeVisualTransparent(runtimeVisualTextEffectiveColor(style))
      || runtimeVisualShadowHasPaint(textShadow)
      || Boolean(
        decorationLine
        && decorationLine !== "none"
        && !runtimeVisualTransparent(decorationColor)
      )
      || (strokeWidth > 0 && !runtimeVisualTransparent(strokeColor))
    );
  };
  const runtimeVisualTextPaintSignature = (style) => (
    runtimeVisualArrayJoin(runtimeVisualTextPaint(style), "|")
  );
  const runtimeVisualBoxPaint = (style) => {
    const borderVisible = runtimeVisualArraySome(
      ["top", "right", "bottom", "left"],
      (sideName) => (
        runtimeVisualParseFloat(
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
      || runtimeVisualShadowHasPaint(runtimeVisualStyleValue(style, "box-shadow"))
      || Boolean(
        runtimeVisualStyleValue(style, "filter")
        && runtimeVisualStyleValue(style, "filter") !== "none"
      )
      || RuntimeVisualNumber(runtimeVisualStyleValue(style, "opacity") || 1) < 1;
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
    const hostAtomCount = capture.content.length
      + capture.paint.length
      + capture.geometry.length
      + capture.vector.length;
    if (
      capture[channel].length >= runtimeVisualAtomLimit
      || (channel !== "canvas" && hostAtomCount >= runtimeVisualAtomLimit)
      || capture.valueLength + normalized.length > runtimeVisualValueLimit
      || capture.budget.atoms >= runtimeVisualBatchAtomLimit
      || capture.budget.valueLength + normalized.length > runtimeVisualBatchValueLimit
    ) throw new Error("runtime-visual-budget");
    capture.valueLength += normalized.length;
    capture.budget.atoms += 1;
    capture.budget.valueLength += normalized.length;
    runtimeVisualArrayPush(capture[channel], normalized);
  };
  const runtimeVisualCanvas = (canvas, capture, displayRect, includeDisplaySize) => {
    const width = runtimeVisualMathMax(
      0,
      runtimeVisualMathRound(RuntimeVisualNumber(runtimeVisualCanvasWidth(canvas) || 0)),
    );
    const height = runtimeVisualMathMax(
      0,
      runtimeVisualMathRound(RuntimeVisualNumber(runtimeVisualCanvasHeight(canvas) || 0)),
    );
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
  const captureRuntimeVisualHost = (host, key, sourceBoxSignature, budget) => {
    try {
      if (
        !runtimeVisualIsInstance(RuntimeVisualElement, host)
        || !runtimeVisualSetHas(runtimeVisualExpectedKeySet, key)
        || typeof sourceBoxSignature !== "string"
        || runtimeVisualSnapshotBudgetExhausted(budget)
      ) return null;
      const hostRect = runtimeVisualElementGetBoundingClientRect(host);
      const currentBoxSignature = runtimeVisualSourceBoxSignature(host);
      const hostBoxMutated = sourceBoxSignature !== currentBoxSignature;
      const hostStyle = runtimeVisualGetComputedStyle(host);
      const hostFullyTransparent = runtimeVisualStyleValue(hostStyle, "display") !== "none"
        && runtimeVisualStyleValue(hostStyle, "visibility") !== "hidden"
        && runtimeVisualStyleValue(hostStyle, "visibility") !== "collapse"
        && RuntimeVisualNumber(runtimeVisualStyleValue(hostStyle, "opacity") || 1) <= 0
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
          && runtimeVisualTextHasPaint(runtimeVisualGetComputedStyle(parentElement))
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
        || (capture.paint.length >= 1 && capture.content.length >= 1)
        || (capture.paint.length >= 1 && capture.geometry.length >= 1);
      if (!chartLike) {
        return {
          key,
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
        key,
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
  const runtimeVisualKeyForHost = (host) => {
    const key = runtimeVisualMapGet(runtimeVisualHostKeys, host) || "";
    return runtimeVisualSetHas(runtimeVisualExpectedKeySet, key) ? key : "";
  };
  const runtimeVisualExpectedHosts = () => {
    if (runtimeVisualExpectedKeys.length > runtimeVisualCandidateLimit) return null;
    if (!runtimeVisualExpectedKeys.length) return [];
    drainInitialBindings();
    const orderedHosts = [];
    runtimeVisualArrayForEach(runtimeVisualExpectedKeys, (key) => {
      const host = runtimeVisualMapGet(runtimeVisualIdentityElements, key);
      if (
        runtimeVisualSetHas(runtimeVisualInvalidKeys, key)
        || !runtimeVisualIsInstance(RuntimeVisualElement, host)
        || !runtimeVisualNodeIsConnected(host)
        || runtimeVisualKeyForHost(host) !== key
        || typeof runtimeVisualMapGet(runtimeVisualSourceBoxSignatures, host) !== "string"
      ) return;
      runtimeVisualArrayPush(orderedHosts, host);
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
  const runtimeVisualUnavailableSnapshot = (key) => ({
    key,
    state: "unavailable",
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
  });
  const collectRuntimeVisualSnapshots = async () => {
    const hosts = runtimeVisualExpectedHosts();
    if (hosts === null) return null;
    if (!hosts.length) return [];
    await runtimeVisualPromiseThen(runtimeVisualPromiseRace([
      document.fonts?.ready || runtimeVisualPromiseResolve(),
      runtimeVisualDelay(120),
    ]), () => undefined, () => undefined);
    await runtimeVisualDelay(24);
    await runtimeVisualFrames();
    if (!runtimeVisualHostsMatch(hosts, runtimeVisualExpectedHosts())) return null;
    const runtimeVisualSnapshotBudget = {
      atoms: 0,
      nodes: 0,
      valueLength: 0,
      canvasPixels: 0,
    };
    const first = new RuntimeVisualMap();
    for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
      if (hostIndex > 0 && hostIndex % 4 === 0) await runtimeVisualDelay(0);
      const host = hosts[hostIndex];
      const expectedKey = runtimeVisualKeyForHost(host);
      const sourceBoxSignature = runtimeVisualMapGet(runtimeVisualSourceBoxSignatures, host);
      if (!expectedKey || typeof sourceBoxSignature !== "string") return null;
      const snapshot = captureRuntimeVisualHost(
        host,
        expectedKey,
        sourceBoxSignature,
        runtimeVisualSnapshotBudget,
      );
      runtimeVisualMapSet(
        first,
        expectedKey,
        snapshot?.key === expectedKey
          ? snapshot
          : runtimeVisualUnavailableSnapshot(expectedKey),
      );
    }
    await runtimeVisualDelay(64);
    await runtimeVisualFrames();
    if (!runtimeVisualHostsMatch(hosts, runtimeVisualExpectedHosts())) return null;
    const snapshots = [];
    for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
      if (hostIndex > 0 && hostIndex % 4 === 0) await runtimeVisualDelay(0);
      const host = hosts[hostIndex];
      const key = runtimeVisualKeyForHost(host);
      if (!runtimeVisualSetHas(runtimeVisualExpectedKeySet, key)) return null;
      const sourceBoxSignature = runtimeVisualMapGet(runtimeVisualSourceBoxSignatures, host);
      if (typeof sourceBoxSignature !== "string") return null;
      const firstSnapshot = runtimeVisualMapGet(first, key);
      const capturedSecond = captureRuntimeVisualHost(
        host,
        key,
        sourceBoxSignature,
        runtimeVisualSnapshotBudget,
      );
      const secondSnapshot = capturedSecond?.key === key
        ? capturedSecond
        : runtimeVisualUnavailableSnapshot(key);
      runtimeVisualArrayPush(
        snapshots,
        firstSnapshot
          && runtimeVisualStringify(firstSnapshot) === runtimeVisualStringify(secondSnapshot)
          ? secondSnapshot
          : runtimeVisualUnavailableSnapshot(key),
      );
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
      runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-projection-facts");
    });
    const hosts = runtimeVisualExpectedHosts();
    const hostsByKey = new RuntimeVisualMap();
    runtimeVisualArrayForEach(hosts || [], (host) => {
      runtimeVisualMapSet(
        hostsByKey,
        runtimeVisualKeyForHost(host),
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
    const commentLayouts = [];
    if (side === "before") {
      for (const commentTarget of reviewCommentTargets) {
        const key = safeKey(commentTarget?.key);
        if (!key) continue;
        if (commentTarget?.global === true) {
          runtimeVisualArrayPush(commentLayouts, {
            key,
            left: 22,
            top: 22,
            viewportLeft: 22,
            viewportTop: 22,
            global: true,
          });
          continue;
        }
        let target = commentTarget?.element || null;
        if (target && !runtimeVisualNodeIsConnected(target)) continue;
        if (!target) {
          let matches;
          try {
            matches = runtimeVisualDocumentQuerySelectorAll(
              document,
              RuntimeVisualString(commentTarget?.selector || ""),
            );
          } catch {
            continue;
          }
          if (runtimeVisualNodeListLength(matches) !== 1) continue;
          target = runtimeVisualNodeListItem(matches, 0);
        }
        if (!target) continue;
        const clientRects = runtimeVisualElementGetClientRects(target);
        const rects = [];
        for (let index = 0; index < runtimeVisualDomRectListLength(clientRects); index += 1) {
          const rect = runtimeVisualDomRectListItem(clientRects, index);
          if (rect && rect.width > 0 && rect.height > 0) runtimeVisualArrayPush(rects, rect);
        }
        if (!rects.length) continue;
        const firstRect = rects.reduce((current, rect) => (
          rect.top < current.top ? rect : current
        ));
        const right = Math.max(...rects.map((rect) => rect.right));
        runtimeVisualArrayPush(commentLayouts, {
          key,
          left: right + scrollX + 10,
          top: firstRect.top + scrollY + firstRect.height / 2,
          viewportLeft: right + 10,
          viewportTop: firstRect.top + firstRect.height / 2,
          global: false,
        });
      }
    }
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
  const acceptReviewCommentTargets = (rawTargets) => {
    if (side !== "before" || !runtimeVisualArrayIsArray(rawTargets)) return;
    const targets = [];
    const seenKeys = new RuntimeVisualSet();
    runtimeVisualArrayForEach(rawTargets, (candidate) => {
      if (!candidate || typeof candidate !== "object") return;
      const key = safeKey(candidate.key);
      const global = candidate.global === true;
      const selector = global
        ? "body"
        : typeof candidate.selector === "string"
          ? candidate.selector
          : "";
      const rawSourceNodeId = typeof candidate.sourceNodeId === "string"
        ? candidate.sourceNodeId
        : "";
      const sourceNodeId = safeReviewCommentSourceNodeId(rawSourceNodeId);
      if (rawSourceNodeId && !sourceNodeId) return;
      const identityElement = sourceNodeId
        ? runtimeVisualMapGet(reviewCommentIdentityElements, sourceNodeId)
        : null;
      if (!key || runtimeVisualSetHas(seenKeys, key)) return;
      if (
        sourceNodeId
        && (
          !identityElement
          || runtimeVisualSetHas(reviewCommentInvalidSourceNodeIds, sourceNodeId)
          || !runtimeVisualIsInstance(RuntimeVisualElement, identityElement)
        )
      ) return;
      if (!global && !sourceNodeId && !selector) return;
      runtimeVisualSetAdd(seenKeys, key);
      runtimeVisualArrayPush(targets, {
        key,
        selector,
        global,
        ...(identityElement ? { element: identityElement } : {}),
      });
    });
    reviewCommentTargets = targets;
    scheduleLayoutReport(true);
  };
  if (reviewCommentChannel) {
    reviewCommentChannel.port1.onmessage = (event) => {
      const message = event.data;
      if (
        !message
        || message.source !== "pageroot-ai-review-comment-targets"
        || message.sessionId !== sessionId
        || message.side !== side
        || message.type !== "comment-targets"
      ) return;
      acceptReviewCommentTargets(message.reviewCommentTargets);
    };
    reviewCommentChannel.port1.start();
  }
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
  const recordFocusScrollCommand = (commandId, top = scrollY, left = scrollX) => {
    const maximumScroll = Math.max(0, documentHeight() - innerHeight);
    const resolvedTop = clamp(Number(top || 0), 0, maximumScroll);
    const resolvedLeft = Math.max(0, Number(left || 0));
    activeScrollCommand = { commandId, top: resolvedTop, left: resolvedLeft };
    return activeScrollCommand;
  };
  const scrollToReviewRect = (rect) => {
    if (!rect || rect.height <= 0 || !Number.isFinite(rect.top)) return false;
    const token = "focus-" + Date.now() + "-" + Math.random();
    const top = clamp(
      scrollY + rect.top - Math.max(18, innerHeight * .12),
      0,
      Math.max(0, documentHeight() - innerHeight),
    );
    const command = recordFocusScrollCommand(token, top, scrollX);
    scrollTo({ top: command.top, left: command.left, behavior: "auto" });
    return true;
  };
  const scrollIntoReviewTarget = (target) => {
    const token = "focus-" + Date.now() + "-" + Math.random();
    target.scrollIntoView({ block: "start", behavior: "auto" });
    recordFocusScrollCommand(token);
  };
  const anchorTextNodes = (anchor) => {
    const ownerId = anchor.getAttribute("data-pageroot-review-geometry-owner") || "";
    const nodes = [];
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      let nestedOwner = parent;
      let crossesOwner = false;
      while (nestedOwner && nestedOwner !== anchor) {
        const candidateOwner = nestedOwner.getAttribute("data-pageroot-review-geometry-owner") || "";
        if (
          candidateOwner
          && candidateOwner !== ownerId
          && !nestedOwner.hasAttribute("data-pageroot-review-text")
        ) {
          crossesOwner = true;
          break;
        }
        nestedOwner = nestedOwner.parentElement;
      }
      if (
        parent
        && !crossesOwner
        && parent.namespaceURI === "http://www.w3.org/1999/xhtml"
        && !parent.closest("script, style, noscript, template, [data-pageroot-review-projection-layer]")
      ) nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  };
  const collapsedAnchorRect = (anchor, changeId) => {
    if (anchor.getAttribute("data-pageroot-review-anchor-change") !== changeId) return null;
    const encoded = String(
      anchor.getAttribute("data-pageroot-review-text-anchors") || "",
    ).split(/\s+/).find(Boolean) || "";
    const offset = Math.max(0, Math.trunc(Number(encoded.slice(encoded.lastIndexOf("@") + 1)) || 0));
    const nodes = anchorTextNodes(anchor);
    if (!nodes.length) return null;
    let remaining = offset;
    let targetNode = nodes.at(-1);
    let targetOffset = targetNode?.textContent?.length || 0;
    for (const node of nodes) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) {
        targetNode = node;
        targetOffset = remaining;
        break;
      }
      remaining -= length;
    }
    if (!targetNode) return null;
    const range = document.createRange();
    const targetLength = targetNode.textContent?.length || 0;
    targetOffset = Math.min(targetOffset, targetLength);
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    let rect = range.getBoundingClientRect();
    // A collapsed Range immediately after an authored <br> is often reported
    // on the preceding visual line. Its offset remains the navigation anchor,
    // while the next visible glyph supplies the measurable context rectangle.
    let probeNode = targetNode;
    let probeOffset = targetOffset;
    let probeIndex = nodes.indexOf(targetNode);
    while (probeNode && probeOffset >= (probeNode.textContent?.length || 0)) {
      probeIndex += 1;
      probeNode = nodes[probeIndex] || null;
      probeOffset = 0;
    }
    if (probeNode && (probeNode.textContent?.length || 0) > probeOffset) {
      const probe = document.createRange();
      probe.setStart(probeNode, probeOffset);
      probe.setEnd(probeNode, probeOffset + 1);
      const probeRect = probe.getBoundingClientRect();
      probe.detach();
      if (probeRect.height > 0) rect = probeRect;
    }
    if (rect.height <= 0) {
      const length = targetNode.textContent?.length || 0;
      const start = Math.max(0, Math.min(targetOffset > 0 ? targetOffset - 1 : 0, length));
      const end = Math.min(length, Math.max(start + 1, targetOffset));
      if (end > start) {
        range.setStart(targetNode, start);
        range.setEnd(targetNode, end);
        rect = range.getBoundingClientRect();
      }
    }
    range.detach();
    return rect.height > 0 ? rect : null;
  };
  const focusTarget = (target, panelPath) => {
    revealTarget(target, panelPath);
    if (!target) return;
    requestAnimationFrame(() => {
      if (!scrollToReviewRect(target.getBoundingClientRect())) {
        scrollIntoReviewTarget(target);
      }
    });
  };
  const focusChangeTarget = (changeId, target, panelPath) => {
    revealTarget(target, panelPath);
    requestAnimationFrame(() => {
      const visibleBox = document.querySelector(
        '[data-pageroot-review-overlay-box="' + changeId + '"]',
      );
      if (visibleBox && scrollToReviewRect(visibleBox.getBoundingClientRect())) return;
      const anchors = [...document.querySelectorAll(
        '[data-pageroot-review-anchor-change="' + changeId + '"]',
      )];
      if (anchors.some((anchor) => scrollToReviewRect(collapsedAnchorRect(anchor, changeId)))) return;
      if (target && !scrollToReviewRect(target.getBoundingClientRect())) {
        scrollIntoReviewTarget(target);
      }
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
  const safeProjectionFactKey = (value) => {
    const key = String(value || "").trim();
    return /^[a-z0-9:_-]{1,160}$/iu.test(key) ? key : "";
  };
  const safeProjectionSummary = (value) => {
    const summary = String(value || "").trim();
    return summary && summary.length <= 80 ? summary : "";
  };
  const normalizeProjectionFact = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = safeProjectionFactKey(value.id);
    const type = value.type === "text" || value.type === "structure" || value.type === "style"
      ? value.type
      : "";
    const semanticOwnerId = safeProjectionFactKey(value.semanticOwnerId);
    if (!id || !type || !semanticOwnerId) return null;
    const fact = { id, type, semanticOwnerId };
    const geometryOwnerId = safeProjectionFactKey(value.geometryOwnerId);
    const ownerKey = safeProjectionFactKey(value.ownerKey);
    const textGroup = safeProjectionFactKey(value.textGroup);
    const structureChange = safeProjectionFactKey(value.structureChange);
    const scope = ["text", "text-phrase", "text-line", "text-block", "element", "box", "content"]
      .includes(value.scope)
      ? value.scope
      : "";
    const textScope = ["inline", "sentence", "block"]
      .includes(value.textScope)
      ? value.textScope
      : "";
    const operation = ["none", "insert", "delete", "replace", "layout"].includes(value.operation)
      ? value.operation
      : "";
    const tone = value.tone === "added" || value.tone === "removed" ? value.tone : "";
    const summary = safeProjectionSummary(value.summary);
    const textDensity = Number(value.textDensity);
    if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
    if (ownerKey) fact.ownerKey = ownerKey;
    if (textGroup) fact.textGroup = textGroup;
    if (structureChange) fact.structureChange = structureChange;
    if (scope) fact.scope = scope;
    if (textScope) fact.textScope = textScope;
    if (operation) fact.operation = operation;
    if (tone) fact.tone = tone;
    if (summary) fact.summary = summary;
    if (Number.isFinite(textDensity) && textDensity >= 0 && textDensity <= 1) {
      fact.textDensity = textDensity;
    }
    return fact;
  };
  const projectionFactIdentity = (fact) => [
    fact.type,
    fact.id,
    fact.semanticOwnerId,
    fact.geometryOwnerId || "",
  ].join("\u001f");
  const projectionFactsForElement = (element, fallbackSequence) => {
    const serialized = element.getAttribute("data-pageroot-review-projection-facts");
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed) || parsed.length > 24) return [];
        const seen = new Set();
        const facts = [];
        for (const value of parsed) {
          const fact = normalizeProjectionFact(value);
          if (!fact) return [];
          const key = projectionFactIdentity(fact);
          if (seen.has(key)) continue;
          seen.add(key);
          facts.push(fact);
        }
        return facts;
      } catch {
        return [];
      }
    }
    const changeId = element.getAttribute("data-pageroot-review-marker") || "";
    const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
      || ("fallback-owner-" + changeId + "-" + fallbackSequence);
    const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
    const facts = [];
    if (element.hasAttribute("data-pageroot-review-text")) {
      const textGroup = element.getAttribute("data-pageroot-review-text-group")
        || ("text-marker-" + fallbackSequence);
      facts.push({
        id: textGroup,
        type: "text",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        scope: "text",
        tone: element.getAttribute("data-pageroot-review-text") === "removed" ? "removed" : "added",
        textGroup,
        textScope: element.getAttribute("data-pageroot-review-text-scope") || "inline",
        textDensity: Number(element.getAttribute("data-pageroot-review-text-density") || 0),
        operation: element.getAttribute("data-pageroot-review-text-operation") || "",
        summary: element.getAttribute("data-pageroot-review-summary") || "",
      });
    }
    if (markerTypes(element).includes("structure")) {
      const structureChange = element.getAttribute("data-pageroot-review-structure") || "changed";
      facts.push({
        id: "structure-" + semanticOwnerId + "-" + structureChange,
        type: "structure",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        scope: "element",
        structureChange,
        summary: element.getAttribute("data-pageroot-review-summary") || "结构调整",
      });
    }
    if (markerTypes(element).includes("style")) {
      const ownerKey = element.getAttribute("data-pageroot-review-style-owner")
        || ("style-owner-" + fallbackSequence);
      facts.push({
        id: ownerKey,
        type: "style",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        ownerKey,
        scope: element.getAttribute("data-pageroot-review-style-scope") || "content",
        operation: element.getAttribute("data-pageroot-review-operation") || "",
        summary: element.getAttribute("data-pageroot-review-summary") || "视觉调整",
      });
    }
    return facts.map(normalizeProjectionFact).filter(Boolean);
  };
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
    if (types.length === 1 && summary) return summary;
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
  const rangeClientRects = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()]
      .filter((rect) => rect.width > 1 && rect.height > 1);
    range.detach();
    return rects;
  };
  const crossesGeometryOwner = (node, owner, ownerId) => {
    let candidate = node.parentElement;
    while (candidate && candidate !== owner) {
      const candidateId = candidate.getAttribute("data-pageroot-review-geometry-owner") || "";
      if (
        candidateId
        && candidateId !== ownerId
        && !candidate.hasAttribute("data-pageroot-review-text")
      ) return true;
      candidate = candidate.parentElement;
    }
    return false;
  };
  const contentStyleRects = (element, respectGeometryOwners = false) => {
    const rects = [];
    const ownerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        (node.textContent || "").trim()
        && parent
        && (!respectGeometryOwners || !crossesGeometryOwner(node, element, ownerId))
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
  const textFootprintOwner = (element, geometryOwnerId) => {
    let candidate = element.parentElement;
    while (candidate) {
      if (
        geometryOwnerId
        && candidate.getAttribute("data-pageroot-review-geometry-owner") === geometryOwnerId
        && !candidate.hasAttribute("data-pageroot-review-text")
      ) return candidate;
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
  const protectedTextBetween = (left, right, protectedRecords) => (
    protectedRecords.some((candidate) => (
      recordsShareTextLine(candidate, left)
      && recordsShareTextLine(candidate, right)
      && candidate.left < right.left - .25
      && candidate.right > left.right + .25
    ))
  );
  const mergeTextLineIntervals = (records, protectedRecords = []) => [...records]
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
      if (
        gap <= Math.max(10, minimumHeight * .9)
        && !protectedTextBetween(previous, record, protectedRecords)
      ) {
        previous.left = Math.min(previous.left, record.left);
        previous.top = Math.min(previous.top, record.top);
        previous.right = Math.max(previous.right, record.right);
        previous.bottom = Math.max(previous.bottom, record.bottom);
      } else {
        intervals.push({ ...record });
      }
      return intervals;
    }, []);
  const expandTinyTextInterval = (record, ownerLines, protectedRecords = []) => {
    const height = Math.max(1, record.bottom - record.top);
    const minimumWidth = Math.max(24, height * 1.6);
    if (record.right - record.left >= minimumWidth) return record;
    const ownerLine = ownerLines.find((line) => line.some((candidate) => (
      recordsShareTextLine(candidate, record)
    )));
    const ownerBounds = ownerLine
      ? mergeTextLineIntervals(ownerLine).find((interval) => (
        Math.min(interval.right, record.right) - Math.max(interval.left, record.left) > 0
      )) || null
      : null;
    if (!ownerBounds) return record;
    const leftBoundary = protectedRecords.reduce((boundary, candidate) => (
      recordsShareTextLine(candidate, record)
      && candidate.right <= record.left + .25
      ? Math.max(boundary, candidate.right)
      : boundary
    ), ownerBounds.left);
    const rightBoundary = protectedRecords.reduce((boundary, candidate) => (
      recordsShareTextLine(candidate, record)
      && candidate.left >= record.right - .25
      ? Math.min(boundary, candidate.left)
      : boundary
    ), ownerBounds.right);
    if (rightBoundary <= leftBoundary) return record;
    if (rightBoundary - leftBoundary <= minimumWidth) {
      return { ...record, left: leftBoundary, right: rightBoundary };
    }
    const center = (record.left + record.right) / 2;
    let left = center - minimumWidth / 2;
    let right = center + minimumWidth / 2;
    if (left < leftBoundary) {
      right += leftBoundary - left;
      left = leftBoundary;
    }
    if (right > rightBoundary) {
      left -= right - rightBoundary;
      right = rightBoundary;
    }
    return {
      ...record,
      left: Math.max(leftBoundary, left),
      right: Math.min(rightBoundary, right),
    };
  };
  const boundsForRects = (rects) => rects.length ? {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  } : null;
  const ownerContentRecords = (owner) => contentStyleRects(owner, true)
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => ({
      left: rect.left + scrollX,
      top: rect.top + scrollY,
      right: rect.right + scrollX,
      bottom: rect.bottom + scrollY,
    }));
  const ownerStableTextRecords = (owner) => {
    const ranges = String(
      owner.getAttribute("data-pageroot-review-stable-text-ranges") || "",
    ).split(/\s+/).map((value) => {
      const match = /^(\d+):(\d+)$/u.exec(value);
      return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
    }).filter((range) => range && range.end > range.start);
    if (!ranges.length) return [];
    const nodes = anchorTextNodes(owner);
    if (!nodes.length) return [];
    const boundaryAt = (offset) => {
      let remaining = Math.max(0, Math.trunc(offset));
      for (const node of nodes) {
        const length = node.textContent?.length || 0;
        if (remaining <= length) return { node, offset: remaining };
        remaining -= length;
      }
      const node = nodes.at(-1);
      return node ? { node, offset: node.textContent?.length || 0 } : null;
    };
    const records = [];
    ranges.forEach((sourceRange) => {
      const start = boundaryAt(sourceRange.start);
      const end = boundaryAt(sourceRange.end);
      if (!start || !end) return;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .forEach((rect) => records.push({
          left: rect.left + scrollX,
          top: rect.top + scrollY,
          right: rect.right + scrollX,
          bottom: rect.bottom + scrollY,
        }));
      range.detach();
    });
    return records;
  };
  const textOwnerAllowsBlock = (owner) => {
    if (!owner || !owner.matches(
      "p, h1, h2, h3, h4, h5, h6, li, td, th, caption, div",
    )) return false;
    const style = getComputedStyle(owner);
    if (
      /^(?:inline-)?(?:grid|flex)$/u.test(style.display)
      || (style.columnCount !== "auto" && Number(style.columnCount) > 1)
    ) return false;
    if (owner.matches("div") && owner.querySelector(
      ":scope > address, :scope > article, :scope > aside, :scope > blockquote, :scope > div, :scope > dl, :scope > figure, :scope > form, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > ol, :scope > p, :scope > section, :scope > table, :scope > ul",
    )) return false;
    return true;
  };
  const readableBlockBounds = (owner) => {
    if (!textOwnerAllowsBlock(owner)) return null;
    const records = ownerContentRecords(owner);
    const lines = textLineGroups(records)
      .map((line) => mergeTextLineIntervals(line))
      .filter((line) => line.length > 0);
    if (!lines.length) return null;
    const separatedColumns = lines.some((line) => line.some((interval, index) => {
      const next = line[index + 1];
      if (!next) return false;
      const height = Math.max(1, Math.min(
        interval.bottom - interval.top,
        next.bottom - next.top,
      ));
      return next.left - interval.right > Math.max(24, height * 2);
    }));
    if (separatedColumns) return null;
    const lineBounds = lines.map((line) => boundsForRects(line)).filter(Boolean);
    const separatedRows = lineBounds.some((line, index) => {
      const next = lineBounds[index + 1];
      if (!next) return false;
      const height = Math.max(1, Math.min(
        line.bottom - line.top,
        next.bottom - next.top,
      ));
      return next.top - line.bottom > Math.max(18, height * 1.5);
    });
    return separatedRows ? null : boundsForRects(lineBounds);
  };
  const readableTextRecords = (records) => {
    const groups = new Map();
    records.forEach((record) => {
      const key = [
        record.changeId,
        record.semanticOwnerId,
        record.geometryOwnerId,
        record.factIdentity,
        record.textGroup,
      ].join("|");
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    });
    return [...groups.values()].flatMap((group) => {
      const base = group[0];
      const lines = textLineGroups(group);
      const owner = textFootprintOwner(base.element, base.geometryOwnerId);
      // The fact planner is the sole authority that may promote a replacement
      // to a block.  A render-time density heuristic cannot recover that
      // authority: it has lost the stable-sentence boundaries and would turn
      // a wrapped middle sentence into a frame around its unchanged neighbors.
      const useBlock = base.textOperation === "replace"
        && base.textScope === "block";
      if (useBlock && owner) {
        const ownerBounds = readableBlockBounds(owner);
        if (ownerBounds) {
          return [{
            ...base,
            ...ownerBounds,
            element: owner,
            scope: "text-block",
            visualLine: "block",
            summary: base.summary === "文本调整" && base.textScope !== "block"
              ? "段落改写"
              : base.summary,
            labelPrimary: true,
          }];
        }
      }
      const multiLine = lines.length > 1;
      const ownerLines = owner ? textLineGroups(ownerContentRecords(owner)) : [];
      const protectedRecords = owner ? ownerStableTextRecords(owner) : [];
      return lines.flatMap((line) => mergeTextLineIntervals(line, protectedRecords))
        .map((record) => expandTinyTextInterval(record, ownerLines, protectedRecords))
        .sort((left, right) => left.top - right.top || left.left - right.left)
        .map((record, index) => ({
          ...record,
          scope: multiLine ? "text-line" : "text-phrase",
          visualLine: String(index + 1),
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
    let markerSequence = 0;
    document.querySelectorAll('[data-pageroot-review-marker]').forEach((element) => {
      markerSequence += 1;
      const changeId = element.getAttribute("data-pageroot-review-marker") || "";
      projectionFactsForElement(element, markerSequence)
        .filter((fact) => filter === "all" || fact.type === filter)
        .forEach((fact) => {
          const semanticOwnerId = fact.semanticOwnerId;
          const geometryOwnerId = fact.geometryOwnerId || "";
          const factKey = fact.type + ":" + fact.id;
          const factIdentity = projectionFactIdentity(fact);
          if (fact.type === "text") {
            const textTone = fact.tone === "removed" ? "text-removed" : "text-added";
            const textGroup = fact.textGroup || fact.id;
            rangeClientRects(element).forEach((rect) => records.push({
              element,
              changeId,
              semanticOwnerId,
              geometryOwnerId,
              factKey,
              factIdentity,
              ownerKey: "",
              textGroup,
              textScope: fact.textScope || "inline",
              textDensity: Number(fact.textDensity || 0),
              textOperation: fact.operation || "",
              scope: "text",
              summary: fact.summary || element.getAttribute("data-pageroot-review-summary") || "文本调整",
              tone: textTone,
              tones: [textTone],
              types: ["text"],
              left: rect.left + scrollX,
              top: rect.top + scrollY,
              right: rect.right + scrollX,
              bottom: rect.bottom + scrollY,
            }));
            return;
          }
          const scope = fact.scope || (fact.type === "style" ? "content" : "element");
          const rects = fact.type === "style" && scope === "content"
            ? contentStyleRects(element)
            : [element.getBoundingClientRect()];
          const structureChange = fact.type === "structure" ? fact.structureChange || "" : "";
          const summary = fact.summary || (fact.type === "style"
            ? (fact.operation === "layout" ? "换行调整" : "视觉调整")
            : (structureChange === "from" || structureChange === "to"
              ? "位置调整"
              : "结构调整"));
          rects.forEach((rect) => records.push({
            element,
            changeId,
            semanticOwnerId,
            geometryOwnerId,
            factKey,
            factIdentity,
            ownerKey: fact.ownerKey || "",
            structureChange,
            scope,
            summary,
            tone: fact.type,
            tones: [fact.type],
            types: [fact.type],
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
    const structureDominators = filter === "all"
      ? readableRecords.filter((record) => (
        record.tone === "structure"
        && (record.structureChange === "added" || record.structureChange === "removed")
      ))
      : [];
    const ownerFilteredRecords = readableRecords.filter((record) => !(
      (record.tone === "text-added" || record.tone === "text-removed")
      && structureDominators.some((candidate) => (
        candidate.changeId === record.changeId
        && candidate.semanticOwnerId === record.semanticOwnerId
      ))
    ));
    const dominantStyleBoxes = ownerFilteredRecords.filter((record) => (
      record.tone === "style" && record.scope === "box"
    ));
    const minimalRecords = ownerFilteredRecords.filter((record, index) => {
      if (record.tone === "text-added" || record.tone === "text-removed") return true;
      if (record.tone === "style") {
        const dominatedByBoxOwner = dominantStyleBoxes.some((candidate) => (
          candidate !== record
          && candidate.changeId === record.changeId
          && candidate.semanticOwnerId === record.semanticOwnerId
          && candidate.ownerKey === record.ownerKey
          && candidate.element.contains(record.element)
          && recordContains(candidate, record)
        ));
        if (dominatedByBoxOwner) return false;
        if (record.scope === "box") return true;
      }
      return !ownerFilteredRecords.some((candidate, candidateIndex) => {
        if (
          index === candidateIndex
          || record.changeId !== candidate.changeId
          || record.semanticOwnerId !== candidate.semanticOwnerId
          || record.factIdentity !== candidate.factIdentity
          || record.tone !== candidate.tone
        ) return false;
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
        && left.semanticOwnerId === right.semanticOwnerId
        && left.factIdentity === right.factIdentity
        && left.tone === right.tone
        && recordsAreClose(left, right)
      )),
    ].sort((left, right) => left.changeId.localeCompare(right.changeId) || left.top - right.top || left.left - right.left);
    if (filter === "all") {
      merged = mergeConnectedRecords(merged, (left, right) => (
        left.changeId === right.changeId
        && left.semanticOwnerId === right.semanticOwnerId
        // “全部变化” may suppress a structural child by its explicit owner
        // rule, but it must never turn merely adjacent independent facts into
        // one outline or one mask hole.
        && left.factIdentity === right.factIdentity
        && recordsOverlapStrongly(left, right)
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
      const horizontalInset = record.types.length === 1 && record.types[0] === "text"
        ? 0
        : inset;
      const fragments = (record.fragments || [{
        left: record.left,
        top: record.top,
        right: record.right,
        bottom: record.bottom,
      }]).map((fragment) => ({
        left: fragment.left - horizontalInset,
        top: fragment.top - inset,
        right: fragment.right + horizontalInset,
        bottom: fragment.bottom + inset,
      }));
      const pathData = unionPath(fragments);
      record.renderFragments = fragments;
      record.pathData = pathData;
      const hole = document.createElementNS(namespace, "path");
      hole.setAttribute("data-pageroot-review-mask-hole", record.changeId);
      hole.setAttribute("data-pageroot-review-semantic-owner", record.semanticOwnerId || "");
      hole.setAttribute("data-pageroot-review-geometry-owner", record.geometryOwnerId || "");
      hole.setAttribute("data-pageroot-review-fact", record.factKey || "");
      if (record.textGroup) hole.setAttribute("data-text-group", record.textGroup);
      if (record.ownerKey) {
        hole.setAttribute("data-pageroot-review-mask-owner", record.ownerKey);
      }
      const left = record.left - horizontalInset;
      const top = record.top - inset;
      const width = record.right - record.left + horizontalInset * 2;
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
      const horizontalInset = record.types.length === 1 && record.types[0] === "text"
        ? 0
        : inset;
      const box = document.createElement("div");
      box.setAttribute("data-pageroot-review-overlay-box", record.changeId);
      box.setAttribute("data-pageroot-review-semantic-owner", record.semanticOwnerId || "");
      box.setAttribute("data-pageroot-review-geometry-owner", record.geometryOwnerId || "");
      box.setAttribute("data-pageroot-review-fact", record.factKey || "");
      if (record.ownerKey) {
        box.setAttribute("data-pageroot-review-overlay-owner", record.ownerKey);
      }
      box.dataset.tone = record.tone;
      box.dataset.tones = record.tones.join(" ");
      box.dataset.types = record.types.join(" ");
      box.dataset.scope = record.scope || "element";
      box.dataset.summary = record.summary;
      if (record.textGroup) box.dataset.textGroup = record.textGroup;
      if (record.textOperation) box.dataset.textOperation = record.textOperation;
      if (record.visualLine) box.dataset.visualLine = record.visualLine;
      box.setAttribute(
        "data-pageroot-review-fragment-count",
        String((record.renderFragments || []).length || 1),
      );
      const active = currentState.focus !== "all" && currentState.focus === record.changeId;
      box.dataset.active = active ? "true" : "false";
      const left = record.left - horizontalInset;
      const top = record.top - inset;
      const width = record.right - record.left + horizontalInset * 2;
      const boxHeight = record.bottom - record.top + inset * 2;
      box.style.setProperty("left", left + "px", "important");
      box.style.setProperty("top", top + "px", "important");
      box.style.setProperty("width", width + "px", "important");
      box.style.setProperty("height", boxHeight + "px", "important");
      box.setAttribute("data-left", String(left));
      box.setAttribute("data-top", String(top));
      box.setAttribute("data-width", String(width));
      box.setAttribute("data-height", String(boxHeight));
      box.setAttribute("data-path", record.pathData || "");
      const textOnly = record.types.length === 1 && record.types[0] === "text";
      if (!textOnly && (record.renderFragments || []).length > 1) {
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
  runtimeVisualAddEventListener("message", (event) => {
    const message = event.data;
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "pageroot-ai-review-parent"
      || message.sessionId !== sessionId
    ) return;
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
      focusChangeTarget(changeId, target, message.panelPath?.length ? message.panelPath : message.panelKey);
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
    closeInitialBindings();
    const runtimeVisualSnapshots = await runtimeVisualPromiseThen(
      collectRuntimeVisualSnapshots(),
      (snapshots) => snapshots,
      () => null,
    );
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

export const REVIEW_PAGE_RUNTIME_VISUAL_CAPTURE_ADAPTER =
  Object.freeze<ReviewRuntimeVisualCaptureAdapter>({
    id: "page-bootstrap-runtime-visual-v1",
    createBootstrap: (request: ReviewRuntimeVisualBootstrapRequest) => reviewBootstrap(
      request.identity.sessionId,
      request.side,
      request.identity.sourceSha256BySide[request.side],
      request.runtimeVisualBindings as readonly ReviewRuntimeVisualBootstrapBinding[],
      request.reviewCommentBindings as readonly ReviewCommentBootstrapBinding[],
    ),
  });

function prepareDocument(
  document: Document,
  side: ReviewSide,
  captureIdentity: ReviewRuntimeVisualCaptureIdentity,
  captureAdapter: ReviewRuntimeVisualCaptureAdapter,
  sourcePath?: string,
  externalBootstrap = false,
  runtimeVisualBindings: readonly ReviewRuntimeVisualBootstrapBinding[] = [],
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
): {
  html: string;
  bootstrapJavaScript: string;
  bootstrapFallbackJavaScript: string;
} {
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
  const bootstrapJavaScript = captureAdapter.createBootstrap({
    identity: captureIdentity,
    side,
    runtimeVisualBindings: [...runtimeVisualBindings],
    reviewCommentBindings: [...reviewCommentBindings],
  });
  const bootstrapFallbackJavaScript = captureAdapter.createBootstrap({
    identity: captureIdentity,
    side,
    runtimeVisualBindings: [],
    reviewCommentBindings: [],
  });
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
    bootstrapFallbackJavaScript,
  };
}

export type ReviewDocumentBuildOptions = {
  sessionId: string;
  sourceSha256BySide: Record<ReviewSide, string>;
  sourcePath?: string;
  externalBootstrap?: boolean;
  comments?: readonly CommentItem[];
  captureAdapter?: ReviewRuntimeVisualCaptureAdapter;
};

function* buildReviewDocumentSteps(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): Generator<string, ReviewDocuments, void> {
  const runtimeVisualCaptureIdentity = createReviewRuntimeVisualCaptureIdentity({
    sessionId: options.sessionId,
    sourceSha256BySide: options.sourceSha256BySide,
  });
  const captureAdapter = options.captureAdapter
    ?? REVIEW_PAGE_RUNTIME_VISUAL_CAPTURE_ADAPTER;
  if (
    typeof captureAdapter.id !== "string"
    || !captureAdapter.id
    || typeof captureAdapter.createBootstrap !== "function"
  ) throw new TypeError("Review runtime capture adapter is invalid.");
  if (typeof DOMParser === "undefined") {
    return {
      before: beforeHtml,
      after: afterHtml,
      bootstrapJavaScript: {
        before: captureAdapter.createBootstrap({
          identity: runtimeVisualCaptureIdentity,
          side: "before",
          runtimeVisualBindings: [],
          reviewCommentBindings: [],
        }),
        after: captureAdapter.createBootstrap({
          identity: runtimeVisualCaptureIdentity,
          side: "after",
          runtimeVisualBindings: [],
          reviewCommentBindings: [],
        }),
      },
      bootstrapFallbackJavaScript: {
        before: captureAdapter.createBootstrap({
          identity: runtimeVisualCaptureIdentity,
          side: "before",
          runtimeVisualBindings: [],
          reviewCommentBindings: [],
        }),
        after: captureAdapter.createBootstrap({
          identity: runtimeVisualCaptureIdentity,
          side: "after",
          runtimeVisualBindings: [],
          reviewCommentBindings: [],
        }),
      },
      changes: [],
      outline: [],
      runtimeVisualCandidates: [],
      runtimeVisualCaptureIdentity,
      commentGroups: [],
      commentTargets: [],
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
  yield "parse";
  const commentAnnotations = annotateReviewComments(
    beforeDocument,
    beforeHtml,
    comments,
    sourceProjection.sourceIndex,
  );
  const commentGroups = commentAnnotations.groups;
  const reviewCommentTargets = commentAnnotations.targets;
  beforeDocument.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
  });
  yield "comments";
  annotatePanelPairs(beforeDocument, afterDocument);
  yield "panels";
  annotateActionPairs(beforeDocument, afterDocument);
  yield "actions";
  const beforeSections = candidateSections(beforeDocument);
  yield "candidate-sections-before";
  const afterSections = candidateSections(afterDocument);
  yield "candidate-sections-after";
  const pairs = pairSections(beforeSections, afterSections);
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];
  const runtimeSections: ReviewRuntimeSectionContext[] = [];
  const stylesheetsMatch = reviewStylesheetSignature(beforeDocument)
    === reviewStylesheetSignature(afterDocument);
  yield "section-pairing";

  for (const [pairIndex, pair] of pairs.entries()) {
    const outlineId = `outline-${outline.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const exactStablePair = Boolean(
      !pair.moved
      && stylesheetsMatch
      && pair.before
      && pair.after
      && normalizedMarkup(pair.before) === normalizedMarkup(pair.after)
      && ancestorMarkupSignature(pair.before)
        === ancestorMarkupSignature(pair.after),
    );
    let types: ReviewChangeType[] = [];
    if (!exactStablePair) {
      const annotationSteps = annotateChangePairSteps(pair);
      let annotationStep = annotationSteps.next();
      while (!annotationStep.done) {
        yield annotationStep.value;
        annotationStep = annotationSteps.next();
      }
      types = annotationStep.value;
    }
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
    if ((pairIndex + 1) % 24 === 0) yield "change-annotation";
  }

  const runtimeVisualAnnotations: ReviewRuntimeVisualAnnotations = options.externalBootstrap
    ? annotateRuntimeVisualCandidates(
        beforeDocument,
        afterDocument,
        runtimeSections,
      )
    : {
        candidates: [],
        bindings: { before: [], after: [] },
      };
  const runtimeVisualCandidates = runtimeVisualAnnotations.candidates;
  // Comment attributes are analyzer-only scope hints. Bind every resolved
  // source target in the private first bootstrap, then remove the hints before
  // either document is serialized or can be read back by authored page code.
  const reviewCommentBindings = reviewCommentBootstrapBindings(
    beforeDocument,
    reviewCommentTargets,
  );
  clearReviewCommentScopeAttributes(beforeDocument);
  yield "runtime-candidates";

  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    runtimeVisualCaptureIdentity,
    captureAdapter,
    options.sourcePath,
    options.externalBootstrap,
    runtimeVisualAnnotations.bindings.before,
    reviewCommentBindings,
  );
  yield "prepare-before";
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    runtimeVisualCaptureIdentity,
    captureAdapter,
    options.sourcePath,
    options.externalBootstrap,
    runtimeVisualAnnotations.bindings.after,
  );
  yield "prepare-after";
  return {
    before: preparedBefore.html,
    after: preparedAfter.html,
    bootstrapJavaScript: {
      before: preparedBefore.bootstrapJavaScript,
      after: preparedAfter.bootstrapJavaScript,
    },
    bootstrapFallbackJavaScript: {
      before: preparedBefore.bootstrapFallbackJavaScript,
      after: preparedAfter.bootstrapFallbackJavaScript,
    },
    changes,
    outline,
    runtimeVisualCandidates,
    runtimeVisualCaptureIdentity,
    commentGroups,
    commentTargets: reviewCommentTargets,
  };
}

export function buildReviewDocuments(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): ReviewDocuments {
  const steps = buildReviewDocumentSteps(beforeHtml, afterHtml, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

function yieldReviewAnalysisTask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function measureReviewAnalysisPhase(
  phase: string,
  startedAt: number,
  endedAt: number,
) {
  try {
    globalThis.performance?.measure?.(
      `pageroot:review-analysis:${phase}`,
      { start: startedAt, end: endedAt },
    );
  } catch {
    // Performance diagnostics cannot own review availability.
  }
}

export async function buildReviewDocumentsAsync(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
  control: { isCancelled?: () => boolean } = {},
): Promise<ReviewDocuments> {
  [
    "parse",
    "comments",
    "panels",
    "actions",
    "candidate-sections-before",
    "candidate-sections-after",
    "section-pairing",
    "semantic-row",
    "change-annotation",
    "runtime-candidates",
    "prepare-before",
    "prepare-after",
    "complete",
  ].forEach((phase) => {
    try {
      globalThis.performance?.clearMeasures?.(
        `pageroot:review-analysis:${phase}`,
      );
    } catch {
      // Diagnostics cannot own review analysis.
    }
  });
  const steps = buildReviewDocumentSteps(beforeHtml, afterHtml, options);
  const assertCurrent = () => {
    if (control.isCancelled?.()) {
      throw new Error("Review document analysis was superseded.");
    }
  };
  assertCurrent();
  let segmentStartedAt = globalThis.performance?.now?.() ?? Date.now();
  let step = steps.next();
  let segmentEndedAt = globalThis.performance?.now?.() ?? Date.now();
  measureReviewAnalysisPhase(
    step.done ? "complete" : step.value,
    segmentStartedAt,
    segmentEndedAt,
  );
  while (!step.done) {
    await yieldReviewAnalysisTask();
    assertCurrent();
    segmentStartedAt = globalThis.performance?.now?.() ?? Date.now();
    step = steps.next();
    segmentEndedAt = globalThis.performance?.now?.() ?? Date.now();
    measureReviewAnalysisPhase(
      step.done ? "complete" : step.value,
      segmentStartedAt,
      segmentEndedAt,
    );
  }
  assertCurrent();
  return step.value;
}
