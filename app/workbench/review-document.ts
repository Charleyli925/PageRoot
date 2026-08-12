import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor.types";
import {
  runtimeSnapshotCaptureCandidate,
} from "../domain/runtime-snapshot-hosts.js";
import type {
  RuntimeSnapshotCaptureCandidate,
} from "../domain/runtime-snapshot-hosts.js";
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
  sentenceAwareTextDifferences,
} from "../lib/review-text-diff.js";
import type {
  ReviewTextChangeOperation,
} from "../lib/review-text-diff.js";
import {
  appendTrustedReviewProjectionFact,
  parseReviewProjectionFacts,
  REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT,
  serializeReviewProjectionFacts,
} from "../lib/review-projection-facts.js";
import type {
  ReviewProjectionFact,
} from "../lib/review-projection-facts.js";
import { alignReviewSemanticUnits } from "../lib/review-semantic-alignment.js";
import type {
  ReviewSemanticAlignmentMatch,
} from "../lib/review-semantic-alignment.js";
import type {
  ReviewRuntimeVisualCandidate,
} from "../lib/review-runtime-visual.js";
import { REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT } from "../lib/review-runtime-visual.js";
import { resolveRuntimeSnapshotHosts } from "../domain/runtime-snapshot-hosts.js";
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
  ReviewRuntimeVisualCaptureIdentity,
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
  runtimeVisualCaptureCandidates: Record<ReviewSide, RuntimeSnapshotCaptureCandidate[]>;
  runtimeVisualSourceHtml: Record<ReviewSide, string>;
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
    -webkit-text-emphasis-style: filled dot !important;
    text-emphasis-style: filled dot !important;
    -webkit-text-emphasis-color: #239b56 !important;
    text-emphasis-color: #239b56 !important;
    -webkit-text-emphasis-position: under !important;
    text-emphasis-position: under right !important;
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

  [data-pageroot-review-mask],
  [data-pageroot-review-mask-background],
  [data-pageroot-review-mask-hole],
  [data-pageroot-review-mask-dim] {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: none !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-pageroot-review-mask] {
    mask-type: luminance !important;
  }

  [data-pageroot-review-mask-background] {
    fill: #ffffff !important;
    stroke: none !important;
  }

  [data-pageroot-review-mask-hole] {
    fill: #000000 !important;
    stroke: none !important;
  }

  [data-pageroot-review-mask-dim] {
    fill: #ffffff !important;
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

  [data-pageroot-review-overlay-box][data-tone="text-removed"],
  [data-pageroot-review-overlay-box][data-tone="text-added"] {
    border-color: #6d5ce7 !important;
    border-style: solid !important;
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

  [data-pageroot-review-overlay-box][data-tone="text-removed"] [data-pageroot-review-overlay-shape],
  [data-pageroot-review-overlay-box][data-tone="text-added"] [data-pageroot-review-overlay-shape] {
    stroke: #6d5ce7 !important;
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

const REVIEW_STABLE_IDENTITY_ATTRIBUTE_NAMES = new Set([
  "id",
  "data-test-module",
  "data-native-case",
  "data-section",
  "data-page",
  "data-p",
  "data-tab",
]);

type ReviewAttributeRole = "stable-identity" | "structural" | "presentation" | "disposable";

type ReviewSignatureCache = {
  stableIdentity: WeakMap<Element, string | null>;
  selfCompatibility: WeakMap<Element, string>;
  exactSubtree: WeakMap<Element, string>;
};

function createReviewSignatureCache(): ReviewSignatureCache {
  return {
    stableIdentity: new WeakMap<Element, string | null>(),
    selfCompatibility: new WeakMap<Element, string>(),
    exactSubtree: new WeakMap<Element, string>(),
  };
}

function reviewAttributeRole(attribute: Attr): ReviewAttributeRole {
  const name = attribute.name.toLowerCase();
  if (name.startsWith("data-pageroot-")) return "disposable";
  if (REVIEW_STABLE_IDENTITY_ATTRIBUTE_NAMES.has(name)) return "stable-identity";
  if (VISUAL_ATTRIBUTE_NAMES.has(name)) return "presentation";
  return "structural";
}

function explicitStableElementIdentity(element: Element): string | null {
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

function stableElementIdentity(element: Element, signatures: ReviewSignatureCache): string | null {
  const cached = signatures.stableIdentity.get(element);
  if (cached !== undefined) return cached;
  const value = explicitStableElementIdentity(element);
  signatures.stableIdentity.set(element, value);
  return value;
}

function selfCompatibilitySignature(element: Element, signatures: ReviewSignatureCache): string {
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

function exactSubtreeSignature(element: Element, signatures: ReviewSignatureCache): string {
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

type SectionPair = {
  before: Element | null;
  after: Element | null;
  beforeIndex: number;
  afterIndex: number;
  moved?: boolean;
};

function pairSections(before: Element[], after: Element[]): SectionPair[] {
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
    before.map((element) => visualElementDescriptor(element, parentKey(element), signatures)),
    after.map((element) => visualElementDescriptor(element, parentKey(element), signatures)),
  ).map((pair) => ({
    before: pair.beforeIndex === null ? null : before[pair.beforeIndex],
    after: pair.afterIndex === null ? null : after[pair.afterIndex],
    beforeIndex: pair.beforeIndex ?? -1,
    afterIndex: pair.afterIndex ?? -1,
    ...(pair.moved ? { moved: true } : {}),
  }));
}

type ReviewBootstrapElementBinding = {
  path: number[];
  tagName: string;
  sourceBoxSignature: string;
  identityAttributes: Array<[string, string]>;
  identityText?: string;
};

type ReviewCommentBootstrapBinding = ReviewBootstrapElementBinding & {
  sourceNodeId: string;
};

type ReviewRuntimeBootstrapBinding = ReviewBootstrapElementBinding & {
  candidateKey: string;
};

type ReviewRuntimeVisualAnnotations = {
  candidates: ReviewRuntimeVisualCandidate[];
  captureCandidates: Record<ReviewSide, RuntimeSnapshotCaptureCandidate[]>;
  bindings: Record<ReviewSide, ReviewRuntimeBootstrapBinding[]>;
};

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

function sourceElementsByNodeId(document: Document): Map<string, Element> {
  const elements = new Map<string, Element>();
  document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    const sourceNodeId = element.getAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    if (sourceNodeId) elements.set(sourceNodeId, element);
  });
  return elements;
}

function runtimeOutlineId(element: Element): string | null {
  return element.closest("[data-pageroot-outline-id]")
    ?.getAttribute("data-pageroot-outline-id") || null;
}

function exactHostHasEquivalentBoxStyleFact(
  beforeElement: Element,
  afterElement: Element,
): boolean {
  const boxStyleFacts = (element: Element) => reviewProjectionFactsForElement(element).filter((fact) => (
    fact.type === "style"
    && fact.scope === "box"
    && fact.operation !== "layout"
  ));
  // Fact IDs and semantic owners are disposable analysis identities. For the
  // same exact source host, shared geometry ownership plus the same box scope
  // is the canonical evidence that runtime geometry would be redundant.
  const afterFacts = boxStyleFacts(afterElement);
  return boxStyleFacts(beforeElement).some((beforeFact) => (
    Boolean(beforeFact.geometryOwnerId)
    && afterFacts.some((afterFact) => (
      afterFact.geometryOwnerId === beforeFact.geometryOwnerId
    ))
  ));
}

function annotateRuntimeVisualCandidates({
  beforeHtml,
  afterHtml,
  beforeIndex,
  afterIndex,
  beforeSourceElements,
  afterSourceElements,
  outline,
}: {
  beforeHtml: string;
  afterHtml: string;
  beforeIndex: ReturnType<typeof buildSourceIndex> | null;
  afterIndex: ReturnType<typeof buildSourceIndex> | null;
  beforeSourceElements: ReadonlyMap<string, Element>;
  afterSourceElements: ReadonlyMap<string, Element>;
  outline: readonly ReviewOutlineItem[];
}): ReviewRuntimeVisualAnnotations {
  const captureCandidates: Record<ReviewSide, RuntimeSnapshotCaptureCandidate[]> = {
    before: [],
    after: [],
  };
  const bindings: Record<ReviewSide, ReviewRuntimeBootstrapBinding[]> = {
    before: [],
    after: [],
  };
  const resolved = resolveRuntimeSnapshotHosts({
    beforeHtml,
    afterHtml,
    beforeIndex,
    afterIndex,
  });
  if (!resolved) return { candidates: [], captureCandidates, bindings };
  const outlineById = new Map(outline.map((item) => [item.id, item]));
  const candidates: ReviewRuntimeVisualCandidate[] = [];
  resolved.hosts.forEach(({ before, after }) => {
    const beforeElement = beforeSourceElements.get(before.sourceNodeId);
    const afterElement = afterSourceElements.get(after.sourceNodeId);
    if (!beforeElement || !afterElement) return;
    const beforeOutlineId = runtimeOutlineId(beforeElement);
    const afterOutlineId = runtimeOutlineId(afterElement);
    if (!beforeOutlineId || beforeOutlineId !== afterOutlineId) return;
    const outlineItem = outlineById.get(beforeOutlineId);
    if (!outlineItem) return;
    if (exactHostHasEquivalentBoxStyleFact(beforeElement, afterElement)) return;
    const key = `runtime-host-${candidates.length + 1}`;
    const changeId = outlineItem.changeId || `runtime-change-${outlineItem.id}`;
    const beforeCaptureCandidate = runtimeSnapshotCaptureCandidate(key, before);
    const afterCaptureCandidate = runtimeSnapshotCaptureCandidate(key, after);
    const beforeBinding = reviewBootstrapElementBinding(beforeElement.ownerDocument, beforeElement);
    const afterBinding = reviewBootstrapElementBinding(afterElement.ownerDocument, afterElement);
    if (
      !beforeCaptureCandidate
      || !afterCaptureCandidate
      || !beforeBinding
      || !afterBinding
    ) return;
    captureCandidates.before.push(beforeCaptureCandidate);
    captureCandidates.after.push(afterCaptureCandidate);
    bindings.before.push({ candidateKey: key, ...beforeBinding });
    bindings.after.push({ candidateKey: key, ...afterBinding });
    candidates.push({
      key,
      outlineId: outlineItem.id,
      changeId,
      label: outlineItem.label,
      sourceHostTargetRefs: {
        before: before.hostTargetRef,
        after: after.hostTargetRef,
      },
      ...(outlineItem.panelKey ? { panelKey: outlineItem.panelKey } : {}),
      ...(outlineItem.panelPath?.length ? { panelPath: [...outlineItem.panelPath] } : {}),
    });
  });
  return { candidates, captureCandidates, bindings };
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

type ReviewTextEvidenceGroup = {
  id: string;
  ranges: TextRange[];
  operation: ReviewTextChangeOperation;
  semanticOwnerId: string;
  geometryOwnerId: string;
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
  group: ReviewTextEvidenceGroup,
) {
  marker.dataset.pagerootReviewTextGroup = group.id;
  marker.dataset.pagerootReviewTextOperation = group.operation;
  marker.dataset.pagerootReviewSemanticOwner = group.semanticOwnerId;
  marker.dataset.pagerootReviewGeometryOwner = group.geometryOwnerId;
}

function wrapTextRanges(
  inventory: ReviewTextInventory,
  groups: ReviewTextEvidenceGroup[],
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
    const appendDifference = (value: string, group: ReviewTextEvidenceGroup) => {
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
  signatures: ReviewSignatureCache;
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

function atomicContentSemanticUnit(element: Element): ReviewSemanticUnit {
  return {
    kind: "atomic-content",
    element,
    inventory: null,
    children: [],
  };
}

function semanticFlowUnit(
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

function semanticChildrenForContainer(container: Element): ReviewSemanticUnit[] {
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

function semanticUnitDescriptor(
  unit: ReviewSemanticUnit,
  parentKey: string,
  signatures: ReviewSignatureCache,
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
    stableId: ownsElementIdentity ? stableElementIdentity(unit.element, signatures) : null,
    exactSignature,
    compatibilitySignature: `${unit.kind}\u0000${logicalCell}\u0000${selfCompatibilitySignature(
      unit.element,
      signatures,
    )}`,
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
      before.children.map((unit) => semanticUnitDescriptor(unit, parentKey, signatures)),
      after.children.map((unit) => semanticUnitDescriptor(unit, parentKey, signatures)),
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
    signatures,
  };
}

function flattenReviewSemanticPairs(root: ReviewSemanticPairNode): ReviewSemanticPairNode[] {
  return [root, ...root.children.flatMap(flattenReviewSemanticPairs)];
}

function markSemanticTextFootprintOwner(
  unit: ReviewSemanticUnit,
  groups: ReviewTextEvidenceGroup[],
) {
  unit.element.setAttribute(
    "data-pageroot-review-geometry-owner",
    groups[0]?.geometryOwnerId || "",
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
  const group: ReviewTextEvidenceGroup = {
    id: groupId,
    ranges: side.phraseGroups.flat(),
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
    const createGroups = (
      ranges: TextRange[][],
      geometryOwnerId: string,
    ): ReviewTextEvidenceGroup[] => ranges.map((groupRanges, index) => ({
      id: `${groupBase}-${index + 1}`,
      ranges: groupRanges,
      operation: plan.operation,
      semanticOwnerId: pair.semanticOwnerId,
      geometryOwnerId,
    }));
    const beforeGroups = createGroups(plan.before.phraseGroups, pair.geometryOwnerId);
    const afterGroups = createGroups(plan.after.phraseGroups, pair.geometryOwnerId);
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

function visualElementDescriptor(
  element: Element,
  parentKey: string,
  signatures: ReviewSignatureCache,
) {
  return {
    kind: `${element.namespaceURI || ""}:${element.localName.toLowerCase()}`,
    text: normalizedText(element),
    stableId: stableElementIdentity(element, signatures),
    exactSignature: exactSubtreeSignature(element, signatures),
    compatibilitySignature: selfCompatibilitySignature(element, signatures),
    parentKey,
  };
}

/**
 * Element-level visual analysis deliberately shares the semantic matching
 * kernel. It only ever receives direct children of an already paired parent,
 * so it cannot turn an unrelated page descendant into a visual counterpart.
 */
function alignElementSiblings(
  before: Element[],
  after: Element[],
  signatures: ReviewSignatureCache,
): Map<Element, Element> {
  const parentKey = "paired-element-siblings";
  const assignments = new Map<Element, Element>();
  const pairs = alignReviewSemanticUnits(
    before.map((element) => visualElementDescriptor(element, parentKey, signatures)),
    after.map((element) => visualElementDescriptor(element, parentKey, signatures)),
  );
  pairs.forEach((pair) => {
    if (pair.beforeIndex === null || pair.afterIndex === null) return;
    assignments.set(before[pair.beforeIndex], after[pair.afterIndex]);
  });
  return assignments;
}

function pairedVisualElements(
  beforeRoot: Element,
  afterRoot: Element,
  signatures: ReviewSignatureCache,
): Array<{ before: Element; after: Element }> {
  const pairs: Array<{ before: Element; after: Element }> = [{
    before: beforeRoot,
    after: afterRoot,
  }];
  for (let cursor = 0; cursor < pairs.length; cursor += 1) {
    const pair = pairs[cursor];
    const siblings = alignElementSiblings(
      [...pair.before.children],
      [...pair.after.children],
      signatures,
    );
    siblings.forEach((afterElement, beforeElement) => {
      pairs.push({ before: beforeElement, after: afterElement });
    });
  }
  return pairs;
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

function structuralSelfSignature(
  element: Element,
  signatures: ReviewSignatureCache,
): string {
  return selfCompatibilitySignature(element, signatures);
}

function markStructureElement(element: Element, tone: string, semanticOwnerId: string) {
  element.setAttribute("data-pageroot-review-structure", tone);
  element.setAttribute("data-pageroot-review-semantic-owner", semanticOwnerId);
}

function* markStructureDifferenceSteps(
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
  const facts = appendTrustedReviewProjectionFact(reviewProjectionFactsForElement(element), fact);
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

function* changeTypesForSemanticGraphSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", ReviewChangeType[], void> {
  // Style inspection still runs against the unwrapped source DOM. The same
  // layout planner identifies visual-only pairs first; text marking consumes
  // it again below to avoid fabricating red/green evidence.
  const layoutPairs = semanticLayoutPairs(graph);
  const structureChanged = yield* markStructureDifferenceSteps(graph);
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
  return yield* changeTypesForSemanticGraphSteps(graph);
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
      const textSummary = textMarker
        ? textOperation === "insert"
          ? "新增内容"
          : textOperation === "delete"
            ? "删除内容"
            : "文本调整"
        : "";
      if (textMarker) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-text-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const textGroup = element.getAttribute("data-pageroot-review-text-group")
          || `text-marker-${index + 1}`;
        facts = appendTrustedReviewProjectionFact(facts, {
          id: textGroup,
          type: "text",
          semanticOwnerId,
          ...(geometryOwnerId ? { geometryOwnerId } : {}),
          scope: "text",
          tone: element.getAttribute("data-pageroot-review-text") === "removed"
            ? "removed"
            : "added",
          textGroup,
          ...(normalizedTextOperation ? { operation: normalizedTextOperation } : {}),
          summary: textSummary,
        });
      }
      if (element.hasAttribute("data-pageroot-review-structure")) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-structure-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const structureChange = element.getAttribute("data-pageroot-review-structure") || "changed";
        facts = appendTrustedReviewProjectionFact(facts, {
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
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
  runtimeProjectionBindings: readonly ReviewRuntimeBootstrapBinding[] = [],
): string {
  const serializedBootstrapPayload = (value: unknown) => (
    JSON.stringify(value).replace(/</gu, "\\u003c")
  );
  return String.raw`
(() => {
  const runtimeVisualContractVersion = ${RUNTIME_VISUAL_CONTRACT_VERSION};
  const sessionId = ${JSON.stringify(sessionId)};
  const side = ${JSON.stringify(side)};
  const sourceSha256 = ${JSON.stringify(sourceSha256)};
  // This first managed script binds private projection targets before authored
  // scripts execute. The binding payload is available only through the first
  // one-shot bootstrap response; authored markup and ordinary window messages
  // never receive source identities, candidate keys, or screenshots.
  const reviewCommentInitialBindings = Object.freeze(
    ${serializedBootstrapPayload(reviewCommentBindings)},
  );
  const runtimeProjectionInitialBindings = Object.freeze(
    ${serializedBootstrapPayload(runtimeProjectionBindings)},
  );
  const runtimeVisualBindCall = (method) => Function.prototype.call.bind(method);
  const runtimeVisualFunctionHasInstance = runtimeVisualBindCall(
    Function.prototype[Symbol.hasInstance],
  );
  const RuntimeVisualElement = Element;
  const RuntimeVisualMap = Map;
  const RuntimeVisualSet = Set;
  const RuntimeVisualString = String;
  const runtimeVisualBoolean = Boolean;
  const runtimeVisualMathFloor = Math.floor.bind(Math);
  const runtimeVisualSetTimeout = window.setTimeout.bind(window);
  const runtimeVisualArrayPush = runtimeVisualBindCall(Array.prototype.push);
  const runtimeVisualArrayForEach = runtimeVisualBindCall(Array.prototype.forEach);
  const runtimeVisualArrayJoin = runtimeVisualBindCall(Array.prototype.join);
  const runtimeVisualArrayMap = runtimeVisualBindCall(Array.prototype.map);
  const runtimeVisualArrayIsArray = Array.isArray.bind(Array);
  const runtimeVisualStringCharCodeAt = runtimeVisualBindCall(
    String.prototype.charCodeAt,
  );
  const runtimeVisualStringToLowerCase = runtimeVisualBindCall(String.prototype.toLowerCase);
  const runtimeVisualStringFromCharCode = String.fromCharCode.bind(String);
  const runtimeVisualRegExpExec = runtimeVisualBindCall(RegExp.prototype.exec);
  const runtimeVisualDocumentQuerySelectorAll = runtimeVisualBindCall(
    Document.prototype.querySelectorAll,
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
  const runtimeVisualElementQuerySelectorAll = runtimeVisualBindCall(
    Element.prototype.querySelectorAll,
  );
  const runtimeVisualElementGetClientRects = runtimeVisualBindCall(
    Element.prototype.getClientRects,
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
  const runtimeVisualMutationRecordAddedNodes = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "addedNodes").get,
  );
  const runtimeVisualDomRectListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(DOMRectList.prototype, "length").get,
  );
  const runtimeVisualDomRectListItem = runtimeVisualBindCall(DOMRectList.prototype.item);
  const runtimeVisualMapGet = runtimeVisualBindCall(Map.prototype.get);
  const runtimeVisualMapHas = runtimeVisualBindCall(Map.prototype.has);
  const runtimeVisualMapSet = runtimeVisualBindCall(Map.prototype.set);
  const runtimeVisualMapForEach = runtimeVisualBindCall(Map.prototype.forEach);
  const runtimeVisualSetHas = runtimeVisualBindCall(Set.prototype.has);
  const runtimeVisualSetAdd = runtimeVisualBindCall(Set.prototype.add);
  const runtimeVisualStringify = JSON.stringify.bind(JSON);
  const runtimeVisualIsInstance = (constructor, value) => (
    runtimeVisualFunctionHasInstance(constructor, value)
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
  // The first managed script runs before authored script. Freeze the
  // session-derived fragment now so later authored prototype changes cannot
  // influence a reserved SVG mask identifier.
  const reviewMaskSessionKey = RuntimeVisualString(sessionId)
    .replace(/[^a-z0-9_-]/giu, "_") || "session";
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
  let overlayMaskSequence = 0;
  let projectionTransitioning = false;
  let initialProjectionCommitted = false;
  let mirroringPanel = false;
  let mirroringAction = false;
  let currentState = { filter: "all", focus: "all", transparency: 18, scale: 1 };
  const reviewParent = parent;
  const postToParent = reviewParent.postMessage.bind(reviewParent);
  const runtimeVisualAddEventListener = addEventListener.bind(window);
  // Comment lookup and runtime projection use distinct capabilities, ports,
  // namespaces, and lifecycles. Neither capability appears in authored markup.
  const reviewCommentChannel = side === "before" && typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  const runtimeProjectionChannel = runtimeProjectionInitialBindings.length
    && typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  const stopImmediateMessagePropagation = Function.prototype.call.bind(
    Event.prototype.stopImmediatePropagation,
  );
  let reviewCommentChannelTransferred = false;
  let runtimeProjectionChannelTransferred = false;
  let reviewCommentTargets = [];
  let pendingReviewCommentChannelChallenge = null;
  let pendingRuntimeProjectionChannelChallenge = null;
  let privateChannelRequestsReady = false;
  const capturePrivateChannelRequest = (event) => {
    const message = event.data;
    const requestsCommentChannel = message?.type === "request-review-comment-channel";
    const requestsRuntimeProjectionChannel = message?.type
      === "request-runtime-projection-channel";
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "pageroot-ai-review-parent"
      || message.sessionId !== sessionId
      || (!requestsCommentChannel && !requestsRuntimeProjectionChannel)
      || (
        requestsRuntimeProjectionChannel
        && (
          message.contractVersion !== runtimeVisualContractVersion
          || message.side !== side
          || message.sourceSha256 !== sourceSha256
        )
      )
    ) return;
    // This listener is installed by the first owned script with capture=true.
    // It consumes the capability challenge before authored capture listeners can
    // observe it or race a forged port back to the parent.
    stopImmediateMessagePropagation(event);
    if (requestsCommentChannel) {
      pendingReviewCommentChannelChallenge = message.challenge;
    } else {
      pendingRuntimeProjectionChannelChallenge = message.challenge;
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
  const transferReviewCommentChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (runtimeVisualRegExpExec(/^[a-f0-9]{32}$/u, challenge) === null) return;
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
  const transferRuntimeProjectionChannel = (rawChallenge) => {
    const challenge = RuntimeVisualString(rawChallenge || "");
    if (runtimeVisualRegExpExec(/^[a-f0-9]{32}$/u, challenge) === null) return;
    if (!runtimeProjectionChannel || runtimeProjectionChannelTransferred) return;
    runtimeProjectionChannelTransferred = true;
    postToParent({
      source: "pageroot-ai-review",
      contractVersion: runtimeVisualContractVersion,
      sessionId,
      side,
      sourceSha256,
      type: "runtime-projection-channel",
      challenge,
    }, "*", [runtimeProjectionChannel.port2]);
  };
  const drainPrivateChannelRequests = () => {
    const commentChallenge = pendingReviewCommentChannelChallenge;
    const runtimeProjectionChallenge = pendingRuntimeProjectionChannelChallenge;
    pendingReviewCommentChannelChallenge = null;
    pendingRuntimeProjectionChannelChallenge = null;
    if (commentChallenge !== null) transferReviewCommentChannel(commentChallenge);
    if (runtimeProjectionChallenge !== null) {
      transferRuntimeProjectionChannel(runtimeProjectionChallenge);
    }
  };
  privateChannelRequestsReady = true;
  drainPrivateChannelRequests();
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const documentHeight = () => Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
  );
  const safeKey = (value) => {
    const source = RuntimeVisualString(value || "");
    let result = "";
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      if (
        (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x5a)
        || (code >= 0x61 && code <= 0x7a)
        || code === 0x2d
      ) result += source[index];
    }
    return result;
  };
  const safePanelPath = (value) => [...new Set(
    (Array.isArray(value) ? value : String(value || "").split(/\s+/))
      .map(safeKey)
      .filter(Boolean),
  )];
  const runtimeVisualSourceBoxAttributes = ${JSON.stringify(REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES)};
  const runtimeVisualCandidateLimit = ${REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT};
  const runtimeProjectionFactLimit = ${REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT};
  const runtimeVisualIdentityAttributeLimit = ${RUNTIME_VISUAL_CONTRACT.identityAttributeLimit};
  const reviewCommentSourceNodeIdPattern = /^element:\d+:\d+:[a-z][a-z0-9:-]{0,127}$/iu;
  const safeReviewCommentSourceNodeId = (value) => {
    const sourceNodeId = RuntimeVisualString(value || "");
    return sourceNodeId.length <= 256
      && runtimeVisualRegExpExec(reviewCommentSourceNodeIdPattern, sourceNodeId) !== null
      ? sourceNodeId
      : "";
  };
  const safeRuntimeProjectionCandidateKey = (value) => {
    const candidateKey = RuntimeVisualString(value || "");
    return candidateKey.length <= 160 && safeKey(candidateKey) === candidateKey
      ? candidateKey
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
        runtimeVisualRegExpExec(runtimeVisualBindingAttributeNamePattern, name) === null
        || runtimeVisualRegExpExec(runtimeVisualOwnedAttributeNamePattern, name) !== null
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
  const runtimeVisualInitialBindingHasFingerprint = (binding) => {
    const attributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    return runtimeVisualBoolean(
      attributes?.length
      || (typeof binding?.identityText === "string" && binding.identityText.length),
    );
  };
  const runtimeVisualInitialBindingSourceBoxMatches = (element, binding) => (
    RuntimeVisualString(binding?.sourceBoxSignature || "")
      === runtimeVisualSourceBoxSignature(element)
  );
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
  const createPrivateInitialBindingRegistry = (
    initialBindings,
    bindingId,
    strictOriginalElement = false,
  ) => {
    const identityElements = new RuntimeVisualMap();
    const deferredBindings = new RuntimeVisualMap();
    const invalidBindingIds = new RuntimeVisualSet();
    const bindingById = new RuntimeVisualMap();
    runtimeVisualArrayForEach(initialBindings, (binding) => {
      const id = bindingId(binding);
      if (!id) return;
      if (runtimeVisualMapHas(bindingById, id)) {
        runtimeVisualSetAdd(invalidBindingIds, id);
        return;
      }
      runtimeVisualMapSet(bindingById, id, binding);
    });
    const initialBindingForPath = (element, binding) => {
      let matchingBinding = null;
      runtimeVisualArrayForEach(initialBindings, (candidate) => {
        const candidateId = bindingId(candidate);
        if (
          matchingBinding
          || candidate === binding
          || !candidateId
          || runtimeVisualSetHas(invalidBindingIds, candidateId)
          || !runtimeVisualInitialBindingPathMatches(element, candidate)
          || !runtimeVisualInitialBindingMatches(element, candidate, true)
          || !runtimeVisualInitialBindingSourceBoxMatches(element, candidate)
        ) return;
        matchingBinding = candidate;
      });
      return matchingBinding;
    };
    const capture = (binding, observedElement = null) => {
      const id = bindingId(binding);
      if (!id || runtimeVisualSetHas(invalidBindingIds, id)) return;
      if (observedElement !== null) {
        if (strictOriginalElement) {
          if (
            !runtimeVisualInitialBindingPathMatches(observedElement, binding)
            || !runtimeVisualInitialBindingMatches(observedElement, binding)
            || !runtimeVisualInitialBindingSourceBoxMatches(observedElement, binding)
          ) return;
          const existing = runtimeVisualMapGet(identityElements, id);
          if (existing && existing !== observedElement) {
            runtimeVisualSetAdd(invalidBindingIds, id);
            return;
          }
          if (!existing) runtimeVisualMapSet(identityElements, id, observedElement);
          return;
        }
        const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
        const identityText = typeof binding?.identityText === "string"
          ? RuntimeVisualString(binding.identityText)
          : "";
        const pathMatches = runtimeVisualInitialBindingPathMatches(observedElement, binding);
        const hasFingerprint = runtimeVisualInitialBindingHasFingerprint(binding);
        if (
          pathMatches
          && !hasFingerprint
          && runtimeVisualInitialBindingMatches(observedElement, binding, true)
        ) {
          const existing = runtimeVisualMapGet(identityElements, id);
          if (existing && existing !== observedElement) {
            runtimeVisualSetAdd(invalidBindingIds, id);
            return;
          }
          if (!existing) runtimeVisualMapSet(identityElements, id, observedElement);
          return;
        }
        // A path-only binding cannot distinguish a same-tag parser decoy after
        // its frozen path shifts. Keep that private identity unavailable.
        if (
          !pathMatches
          && !hasFingerprint
          && runtimeVisualInitialBindingMatches(observedElement, binding, true)
          && runtimeVisualInitialBindingSourceBoxMatches(observedElement, binding)
        ) {
          if (initialBindingForPath(observedElement, binding)) return;
          runtimeVisualSetAdd(invalidBindingIds, id);
          return;
        }
        if (!runtimeVisualInitialBindingMatches(
          observedElement,
          binding,
          runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
        )) return;
        runtimeVisualMapSet(deferredBindings, binding, true);
        return;
      }
      const element = strictOriginalElement
        ? runtimeVisualInitialBindingPathElement(binding?.path)
        : runtimeVisualInitialBindingElement(
            binding,
            !runtimeVisualMapHas(deferredBindings, binding),
          );
      if (!element) return;
      if (
        strictOriginalElement
        && (
          !runtimeVisualInitialBindingMatches(element, binding)
          || !runtimeVisualInitialBindingSourceBoxMatches(element, binding)
        )
      ) return;
      const existing = runtimeVisualMapGet(identityElements, id);
      if (existing && existing !== element) {
        runtimeVisualSetAdd(invalidBindingIds, id);
        return;
      }
      if (!existing) runtimeVisualMapSet(identityElements, id, element);
    };
    const captureAll = (observedElement = null) => runtimeVisualArrayForEach(
      initialBindings,
      (binding) => capture(binding, observedElement),
    );
    const captureDeferred = () => runtimeVisualArrayForEach(initialBindings, (binding) => {
      if (runtimeVisualMapHas(deferredBindings, binding)) capture(binding);
    });
    return {
      initialBindings,
      identityElements,
      deferredBindings,
      invalidBindingIds,
      bindingById,
      captureAll,
      captureDeferred,
    };
  };
  const reviewCommentBindingRegistry = createPrivateInitialBindingRegistry(
    reviewCommentInitialBindings,
    (binding) => safeReviewCommentSourceNodeId(binding?.sourceNodeId),
  );
  const runtimeProjectionBindingRegistry = createPrivateInitialBindingRegistry(
    runtimeProjectionInitialBindings,
    (binding) => safeRuntimeProjectionCandidateKey(binding?.candidateKey),
    true,
  );
  const reviewCommentIdentityElements = reviewCommentBindingRegistry.identityElements;
  const reviewCommentDeferredBindings = reviewCommentBindingRegistry.deferredBindings;
  const reviewCommentInvalidSourceNodeIds = reviewCommentBindingRegistry.invalidBindingIds;
  const runtimeTargetByCandidateKey = runtimeProjectionBindingRegistry.identityElements;
  const runtimeBindingByCandidateKey = runtimeProjectionBindingRegistry.bindingById;
  const runtimeInvalidCandidateKeys = runtimeProjectionBindingRegistry.invalidBindingIds;
  let privateInitialBindingsBootstrapped = false;
  let privateInitialBindingsClosed = false;
  const captureInitialBindings = (records = []) => {
    if (privateInitialBindingsClosed) return;
    if (!privateInitialBindingsBootstrapped) {
      privateInitialBindingsBootstrapped = true;
      reviewCommentBindingRegistry.captureAll();
      runtimeProjectionBindingRegistry.captureAll();
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
          reviewCommentBindingRegistry.captureAll(element);
          runtimeProjectionBindingRegistry.captureAll(element);
        });
      }
    });
  };
  const initialBindingObserver = reviewCommentInitialBindings.length
    || runtimeProjectionInitialBindings.length
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
    if (!initialBindingObserver || privateInitialBindingsClosed) return;
    captureInitialBindings(runtimeVisualMutationObserverTakeRecords(initialBindingObserver));
  };
  const closeInitialBindings = () => {
    if (!initialBindingObserver || privateInitialBindingsClosed) return;
    drainInitialBindings();
    reviewCommentBindingRegistry.captureDeferred();
    runtimeProjectionBindingRegistry.captureDeferred();
    runtimeVisualMutationObserverDisconnect(initialBindingObserver);
    privateInitialBindingsClosed = true;
  };
  let runtimeProjectionFactsByElement = new RuntimeVisualMap();
  const runtimeProjectionTargetIsCurrent = (candidateKey, element) => {
    const binding = runtimeVisualMapGet(runtimeBindingByCandidateKey, candidateKey);
    return runtimeVisualIsInstance(RuntimeVisualElement, element)
      && !runtimeVisualSetHas(runtimeInvalidCandidateKeys, candidateKey)
      && runtimeVisualNodeIsConnected(element)
      && runtimeVisualInitialBindingMatches(element, binding)
      && runtimeVisualInitialBindingSourceBoxMatches(element, binding);
  };
  const applyRuntimeProjectionFacts = (rawMarkers) => {
    const nextFactsByElement = new RuntimeVisualMap();
    const markers = runtimeVisualArrayIsArray(rawMarkers)
      && rawMarkers.length <= runtimeVisualCandidateLimit
      ? rawMarkers
      : [];
    const seenCandidateKeys = new RuntimeVisualSet();
    let valid = runtimeVisualArrayIsArray(rawMarkers)
      && rawMarkers.length <= runtimeVisualCandidateLimit;
    for (let markerIndex = 0; valid && markerIndex < markers.length; markerIndex += 1) {
      const marker = markers[markerIndex];
      const rawCandidateKey = typeof marker?.candidateKey === "string"
        ? marker.candidateKey
        : "";
      const rawChangeId = typeof marker?.changeId === "string" ? marker.changeId : "";
      const candidateKey = safeRuntimeProjectionCandidateKey(rawCandidateKey);
      const changeId = safeKey(rawChangeId);
      if (
        !candidateKey
        || rawCandidateKey !== candidateKey
        || !changeId
        || rawChangeId !== changeId
        || runtimeVisualSetHas(seenCandidateKeys, candidateKey)
        || !runtimeVisualMapHas(runtimeBindingByCandidateKey, candidateKey)
      ) {
        valid = false;
        break;
      }
      runtimeVisualSetAdd(seenCandidateKeys, candidateKey);
      const element = runtimeVisualMapGet(runtimeTargetByCandidateKey, candidateKey);
      if (!runtimeProjectionTargetIsCurrent(candidateKey, element)) continue;
      const ownerKey = "runtime-projection-" + (markerIndex + 1);
      const facts = runtimeVisualMapGet(nextFactsByElement, element) || [];
      if (facts.length >= runtimeProjectionFactLimit) {
        valid = false;
        break;
      }
      runtimeVisualArrayPush(facts, {
        id: ownerKey,
        type: "style",
        semanticOwnerId: ownerKey,
        geometryOwnerId: ownerKey,
        ownerKey,
        scope: "box",
        summary: "视觉调整",
        changeId,
        candidateKey,
      });
      runtimeVisualMapSet(nextFactsByElement, element, facts);
    }
    runtimeProjectionFactsByElement = valid
      ? nextFactsByElement
      : new RuntimeVisualMap();
    initialProjectionCommitted = true;
    scheduleOverlayRender();
    scheduleLayoutReport(true);
  };
  if (runtimeProjectionChannel) {
    let runtimeProjectionCommitReceived = false;
    runtimeProjectionChannel.port1.onmessage = (event) => {
      if (runtimeProjectionCommitReceived) return;
      runtimeProjectionCommitReceived = true;
      const message = event.data;
      if (
        message
        && message.source === "pageroot-ai-review-runtime-projection"
        && message.contractVersion === runtimeVisualContractVersion
        && message.sessionId === sessionId
        && message.side === side
        && message.sourceSha256 === sourceSha256
        && message.type === "runtime-projection-facts"
      ) applyRuntimeProjectionFacts(message.markers);
      runtimeProjectionChannel.port1.onmessage = null;
      runtimeProjectionChannel.port1.close();
    };
    runtimeProjectionChannel.port1.start();
  }
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
    acceptsFollowerScroll = message.linked === true && runtimeVisualBoolean(leader) && leader !== side;
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
    return runtimeVisualRegExpExec(/^[a-z0-9:_-]{1,160}$/iu, key) !== null ? key : "";
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
    const operation = ["none", "insert", "delete", "replace", "layout"].includes(value.operation)
      ? value.operation
      : "";
    const tone = value.tone === "added" || value.tone === "removed" ? value.tone : "";
    const summary = safeProjectionSummary(value.summary);
    if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
    if (ownerKey) fact.ownerKey = ownerKey;
    if (textGroup) fact.textGroup = textGroup;
    if (structureChange) fact.structureChange = structureChange;
    if (scope) fact.scope = scope;
    if (operation) fact.operation = operation;
    if (tone) fact.tone = tone;
    if (summary) fact.summary = summary;
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
    const hasCell = (row, column) => runtimeVisualBoolean(filled[row]?.[column]);
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
  const expandTinyTextInterval = (record, ownerBounds) => {
    const height = Math.max(1, record.bottom - record.top);
    const minimumWidth = Math.max(24, height * 1.6);
    if (record.right - record.left >= minimumWidth || !ownerBounds) return record;
    const leftBoundary = ownerBounds.left;
    const rightBoundary = ownerBounds.right;
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
  const textOwnerAllowsParagraph = (owner) => {
    if (!owner || !owner.matches(
      "p, h1, h2, h3, h4, h5, h6, li, td, th, caption, div",
    )) return false;
    const style = getComputedStyle(owner);
    if (
      runtimeVisualRegExpExec(/^(?:inline-)?(?:grid|flex)$/u, style.display) !== null
      || (style.columnCount !== "auto" && Number(style.columnCount) > 1)
    ) return false;
    if (owner.matches("div") && owner.querySelector(
      ":scope > address, :scope > article, :scope > aside, :scope > blockquote, :scope > div, :scope > dl, :scope > figure, :scope > form, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > ol, :scope > p, :scope > section, :scope > table, :scope > ul",
    )) return false;
    return true;
  };
  const textLineModel = (records, index) => {
    const intervals = mergeTextLineIntervals(records);
    const bounds = boundsForRects(intervals);
    const continuous = !intervals.some((interval, intervalIndex) => {
      const next = intervals[intervalIndex + 1];
      if (!next) return false;
      const height = Math.max(1, Math.min(
        interval.bottom - interval.top,
        next.bottom - next.top,
      ));
      return next.left - interval.right > Math.max(24, height * 2);
    });
    return bounds ? { index, records, intervals, bounds, continuous } : null;
  };
  const ownerTextLineModels = (owner) => textLineGroups(ownerContentRecords(owner))
    .map(textLineModel)
    .filter(Boolean);
  const readableParagraphBounds = (owner, lines) => {
    if (!textOwnerAllowsParagraph(owner) || lines.length < 3) return null;
    if (lines.some((line) => !line.continuous)) return null;
    const separatedRows = lines.some((line, index) => {
      const next = lines[index + 1];
      if (!next) return false;
      const height = Math.max(1, Math.min(
        line.bounds.bottom - line.bounds.top,
        next.bounds.bottom - next.bounds.top,
      ));
      return next.bounds.top - line.bounds.bottom > Math.max(18, height * 1.5);
    });
    return separatedRows ? null : boundsForRects(lines.map((line) => line.bounds));
  };
  const additionEvidenceClearance = (record) => {
    if (record.tone !== "text-added") return 0;
    const fontSize = Number.parseFloat(getComputedStyle(record.element).fontSize || "0");
    return Math.max(4, Number.isFinite(fontSize) ? fontSize * .55 : 8);
  };
  const textEvidenceEnvelope = (record) => ({
    left: record.left,
    top: record.top,
    right: record.right,
    bottom: record.bottom + additionEvidenceClearance(record),
  });
  const lineForTextRecord = (record, lines) => lines.find((line) => (
    recordsShareTextLine(line.bounds, record)
  )) || null;
  const readablePhraseRecord = (records, ownerLine) => {
    const base = records[0];
    const exactBounds = boundsForRects(records);
    if (!exactBounds) return null;
    const readableBounds = expandTinyTextInterval(exactBounds, ownerLine?.bounds || null);
    const bounds = boundsForRects([
      readableBounds,
      ...records.map(textEvidenceEnvelope),
    ]);
    return bounds ? {
      ...base,
      ...bounds,
      textGroups: [base.textGroup],
      scope: "text-phrase",
    } : null;
  };
  const recordsByTextGroup = (records) => records.reduce((groups, record) => {
    const phrase = groups.get(record.textGroup) || [];
    phrase.push(record);
    groups.set(record.textGroup, phrase);
    return groups;
  }, new Map());
  const textScopeOwnerKey = (record) => [
    record.changeId,
    record.semanticOwnerId,
    record.geometryOwnerId,
    record.textOperation,
    record.tone,
  ].join("|");
  const promoteTextScopeRecords = (records) => {
    const base = records[0];
    const owner = textFootprintOwner(base.element, base.geometryOwnerId);
    const ownerLines = owner ? ownerTextLineModels(owner) : [];
    if (!owner || !ownerLines.length) {
      return textLineGroups(records).flatMap((line, lineIndex) => {
        return [...recordsByTextGroup(line).values()]
          .map((phrase) => readablePhraseRecord(phrase, null))
          .filter(Boolean)
          .map((record) => ({ ...record, visualLine: String(lineIndex + 1) }));
      });
    }
    const recordsByLine = new Map();
    const unassigned = [];
    records.forEach((record) => {
      const line = lineForTextRecord(record, ownerLines);
      if (!line) {
        unassigned.push(record);
        return;
      }
      const lineRecords = recordsByLine.get(line.index) || [];
      lineRecords.push(record);
      recordsByLine.set(line.index, lineRecords);
    });
    const lineResults = [];
    let promotedLineCount = 0;
    ownerLines.forEach((line) => {
      const lineRecords = recordsByLine.get(line.index) || [];
      if (!lineRecords.length) return;
      const phraseRecords = recordsByTextGroup(lineRecords);
      const evidenceBounds = boundsForRects(lineRecords);
      const lineWidth = Math.max(1, line.bounds.right - line.bounds.left);
      const spanRatio = evidenceBounds
        ? (evidenceBounds.right - evidenceBounds.left) / lineWidth
        : 0;
      const promoteLine = line.continuous && (
        phraseRecords.size >= 3 || spanRatio >= .6
      );
      if (promoteLine) {
        promotedLineCount += 1;
        const textGroups = [...phraseRecords.keys()];
        const bounds = boundsForRects([
          line.bounds,
          ...lineRecords.map(textEvidenceEnvelope),
        ]);
        if (bounds) lineResults.push({
          ...lineRecords[0],
          ...bounds,
          element: owner,
          textGroup: textGroups[0],
          textGroups,
          scope: "text-line",
          visualLine: String(line.index + 1),
        });
        return;
      }
      phraseRecords.forEach((phrase) => {
        const record = readablePhraseRecord(phrase, line);
        if (record) lineResults.push({
          ...record,
          visualLine: String(line.index + 1),
        });
      });
    });
    if (!unassigned.length && promotedLineCount / ownerLines.length >= .75) {
      const paragraphBounds = readableParagraphBounds(owner, ownerLines);
      const bounds = paragraphBounds ? boundsForRects([
        paragraphBounds,
        ...records.map(textEvidenceEnvelope),
      ]) : null;
      if (bounds) {
        const textGroups = [...new Set(records.map((record) => record.textGroup))];
        return [{
          ...base,
          ...bounds,
          element: owner,
          textGroup: textGroups[0],
          textGroups,
          scope: "text-block",
          visualLine: "block",
          summary: base.textOperation === "replace" ? "段落改写" : base.summary,
          labelPrimary: true,
        }];
      }
    }
    if (unassigned.length) {
      textLineGroups(unassigned).forEach((line, lineIndex) => {
        recordsByTextGroup(line).forEach((phrase) => {
          const record = readablePhraseRecord(phrase, null);
          if (record) lineResults.push({
            ...record,
            visualLine: "unassigned-" + String(lineIndex + 1),
          });
        });
      });
    }
    return lineResults;
  };
  const readableTextRecords = (records) => {
    const groups = new Map();
    records.forEach((record) => {
      const key = textScopeOwnerKey(record);
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    });
    const readable = [...groups.values()].flatMap(promoteTextScopeRecords)
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const labelled = new Set();
    return readable.map((record) => {
      const key = textScopeOwnerKey(record);
      const labelPrimary = record.labelPrimary === true || !labelled.has(key);
      labelled.add(key);
      return { ...record, labelPrimary };
    });
  };
  function renderReviewOverlays() {
    if (projectionTransitioning) return;
    document.querySelector('[data-pageroot-review-projection-layer]')?.remove();
    const filter = currentState.filter || "all";
    const records = [];
    const projectionEntriesByElement = new RuntimeVisualMap();
    let markerSequence = 0;
    const appendProjectionEntry = (element, rawChangeId, rawFact) => {
      const changeId = safeKey(rawChangeId);
      const fact = normalizeProjectionFact(rawFact);
      if (!changeId || rawChangeId !== changeId || !fact) return;
      const entries = runtimeVisualMapGet(projectionEntriesByElement, element) || [];
      const factIdentity = projectionFactIdentity(fact);
      let duplicate = false;
      runtimeVisualArrayForEach(entries, (entry) => {
        if (
          entry.changeId === changeId
          && projectionFactIdentity(entry.fact) === factIdentity
        ) duplicate = true;
      });
      if (!duplicate) runtimeVisualArrayPush(entries, { changeId, fact });
      runtimeVisualMapSet(projectionEntriesByElement, element, entries);
    };
    document.querySelectorAll('[data-pageroot-review-marker]').forEach((element) => {
      markerSequence += 1;
      const changeId = element.getAttribute("data-pageroot-review-marker") || "";
      projectionFactsForElement(element, markerSequence).forEach((fact) => {
        appendProjectionEntry(element, changeId, fact);
      });
    });
    runtimeVisualMapForEach(runtimeProjectionFactsByElement, (facts, element) => {
      runtimeVisualArrayForEach(facts, (fact) => {
        if (!runtimeProjectionTargetIsCurrent(fact.candidateKey, element)) return;
        appendProjectionEntry(element, fact.changeId, fact);
      });
    });
    runtimeVisualMapForEach(projectionEntriesByElement, (entries, element) => {
      runtimeVisualArrayForEach(entries, ({ changeId, fact }) => {
        if (filter !== "all" && fact.type !== filter) return;
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
        !left.types.includes("text")
        && !right.types.includes("text")
        && left.changeId === right.changeId
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
    const resetMaskPrimitive = (element, fill = "") => {
      element.style.setProperty("display", "block", "important");
      element.style.setProperty("margin", "0", "important");
      element.style.setProperty("padding", "0", "important");
      element.style.setProperty("border", "0", "important");
      element.style.setProperty("outline", "none", "important");
      element.style.setProperty("opacity", "1", "important");
      element.style.setProperty("filter", "none", "important");
      element.style.setProperty("transform", "none", "important");
      element.style.setProperty("pointer-events", "none", "important");
      if (!fill) return;
      element.style.setProperty("fill", fill, "important");
      element.style.setProperty("fill-opacity", "1", "important");
      element.style.setProperty("stroke", "none", "important");
    };
    const mask = document.createElementNS(namespace, "mask");
    const maskId = "pageroot-review-mask-"
      + reviewMaskSessionKey + "-" + side + "-" + projectionEpoch + "-" + (++overlayMaskSequence);
    mask.setAttribute("data-pageroot-review-mask", "true");
    mask.setAttribute("id", maskId);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    mask.setAttribute("mask-type", "luminance");
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", String(documentWidth));
    mask.setAttribute("height", String(height));
    resetMaskPrimitive(mask);
    mask.style.setProperty("mask-type", "luminance", "important");
    const maskBackground = document.createElementNS(namespace, "rect");
    maskBackground.setAttribute("data-pageroot-review-mask-background", "true");
    maskBackground.setAttribute("x", "0");
    maskBackground.setAttribute("y", "0");
    maskBackground.setAttribute("width", String(documentWidth));
    maskBackground.setAttribute("height", String(height));
    maskBackground.setAttribute("fill", "#ffffff");
    resetMaskPrimitive(maskBackground, "#ffffff");
    mask.append(maskBackground);
    merged.forEach((record) => {
      const horizontalInset = inset;
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
      if (record.textGroups?.length) {
        hole.setAttribute("data-text-groups", record.textGroups.join(" "));
      }
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
      hole.setAttribute("fill", "#000000");
      resetMaskPrimitive(hole, "#000000");
      mask.append(hole);
    });
    const defs = document.createElementNS(namespace, "defs");
    defs.append(mask);
    svg.append(defs);
    const dim = document.createElementNS(namespace, "rect");
    dim.setAttribute("data-pageroot-review-mask-dim", "true");
    dim.setAttribute("x", "0");
    dim.setAttribute("y", "0");
    dim.setAttribute("width", String(documentWidth));
    dim.setAttribute("height", String(height));
    dim.setAttribute("fill", "#ffffff");
    dim.setAttribute("mask", "url(#" + maskId + ")");
    const contextVisibility = Math.max(0, Math.min(100, Number(currentState.transparency ?? 18))) / 100;
    const dimOpacity = String(Math.round((1 - contextVisibility) * 1_000) / 1_000);
    dim.setAttribute("fill-opacity", dimOpacity);
    resetMaskPrimitive(dim, "#ffffff");
    dim.style.setProperty("fill-opacity", dimOpacity, "important");
    svg.append(dim);
    layer.append(svg);
    merged.forEach((record) => {
      const horizontalInset = inset;
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
      if (record.textGroups?.length) box.dataset.textGroups = record.textGroups.join(" ");
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
          || runtimeVisualBoolean(node.closest("[data-pageroot-review-projection-layer], [data-pageroot-review-transition-mask]")))
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
    // Static facts are independently complete. Runtime projection may arrive
    // later, fail, or be unavailable without delaying or clearing them.
    initialProjectionCommitted = true;
    scheduleOverlayRender();
    announceReady();
    // The initial ready can precede the parent iframe ref. Re-announce through
    // the captured native timer so the parent can replay its static state.
    runtimeVisualSetTimeout(announceReady, 64);
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
  captureIdentity: ReviewRuntimeVisualCaptureIdentity,
  sourcePath?: string,
  externalBootstrap = false,
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
  runtimeProjectionBindings: readonly ReviewRuntimeBootstrapBinding[] = [],
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
  const bootstrapJavaScript = reviewBootstrap(
    captureIdentity.sessionId,
    side,
    captureIdentity.sourceSha256BySide[side],
    reviewCommentBindings,
    runtimeProjectionBindings,
  );
  const bootstrapFallbackJavaScript = reviewBootstrap(
    captureIdentity.sessionId,
    side,
    captureIdentity.sourceSha256BySide[side],
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
    bootstrapFallbackJavaScript,
  };
}

export type ReviewDocumentBuildOptions = {
  sessionId: string;
  sourceSha256BySide: Record<ReviewSide, string>;
  sourcePath?: string;
  externalBootstrap?: boolean;
  comments?: readonly CommentItem[];
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
  if (typeof DOMParser === "undefined") {
    return {
      before: beforeHtml,
      after: afterHtml,
      bootstrapJavaScript: {
        before: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "before",
          runtimeVisualCaptureIdentity.sourceSha256BySide.before,
        ),
        after: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "after",
          runtimeVisualCaptureIdentity.sourceSha256BySide.after,
        ),
      },
      bootstrapFallbackJavaScript: {
        before: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "before",
          runtimeVisualCaptureIdentity.sourceSha256BySide.before,
        ),
        after: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "after",
          runtimeVisualCaptureIdentity.sourceSha256BySide.after,
        ),
      },
      changes: [],
      outline: [],
      runtimeVisualCandidates: [],
      runtimeVisualCaptureCandidates: { before: [], after: [] },
      runtimeVisualSourceHtml: { before: beforeHtml, after: afterHtml },
      runtimeVisualCaptureIdentity,
      commentGroups: [],
      commentTargets: [],
    };
  }
  const parser = new DOMParser();
  const comments = options.comments || [];
  const beforeSourceProjection = prepareReviewCommentSourceProjection(beforeHtml, true);
  const afterSourceProjection = prepareReviewCommentSourceProjection(afterHtml, true);
  const beforeDocument = parser.parseFromString(beforeSourceProjection.html, "text/html");
  const afterDocument = parser.parseFromString(afterSourceProjection.html, "text/html");
  clearReservedReviewMarkup(beforeDocument, beforeSourceProjection.projected);
  clearReservedReviewMarkup(afterDocument, afterSourceProjection.projected);
  const beforeSourceElements = sourceElementsByNodeId(beforeDocument);
  const afterSourceElements = sourceElementsByNodeId(afterDocument);
  yield "parse";
  const commentAnnotations = annotateReviewComments(
    beforeDocument,
    beforeHtml,
    comments,
    beforeSourceProjection.sourceIndex,
  );
  const commentGroups = commentAnnotations.groups;
  const reviewCommentTargets = commentAnnotations.targets;
  [beforeDocument, afterDocument].forEach((document) => {
    document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
      element.removeAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    });
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
    ? annotateRuntimeVisualCandidates({
        beforeHtml,
        afterHtml,
        beforeIndex: beforeSourceProjection.sourceIndex,
        afterIndex: afterSourceProjection.sourceIndex,
        beforeSourceElements,
        afterSourceElements,
        outline,
      })
    : {
        candidates: [],
        captureCandidates: { before: [], after: [] },
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
    options.sourcePath,
    options.externalBootstrap,
    reviewCommentBindings,
    runtimeVisualAnnotations.bindings.before,
  );
  yield "prepare-before";
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    runtimeVisualCaptureIdentity,
    options.sourcePath,
    options.externalBootstrap,
    [],
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
    runtimeVisualCaptureCandidates: runtimeVisualAnnotations.captureCandidates,
    runtimeVisualSourceHtml: { before: beforeHtml, after: afterHtml },
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
