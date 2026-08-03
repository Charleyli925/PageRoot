export type ReviewFilter = "overview" | "all" | "text" | "structure" | "style";
export type ReviewChangeType = Exclude<ReviewFilter, "overview" | "all">;
export type ReviewSide = "before" | "after";

export type ReviewChange = {
  id: string;
  label: string;
  helper: string;
  types: ReviewChangeType[];
  beforePresent: boolean;
  afterPresent: boolean;
  movement?: { from: number; to: number };
};

export type ReviewOutlineItem = {
  id: string;
  group: string;
  label: string;
  helper: string;
  changeId?: string;
  types: ReviewChangeType[];
  movement?: { from: number; to: number };
};

export type ReviewDocuments = {
  before: string;
  after: string;
  bootstrapJavaScript: Record<ReviewSide, string>;
  changes: ReviewChange[];
  outline: ReviewOutlineItem[];
};

const REVIEW_STYLE_ID = "pageroot-ai-review-style";
const REVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-ai-review-bootstrap";
const REVIEW_BASE_ATTRIBUTE = "data-pageroot-ai-review-base";
const REVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";

const REVIEW_DOCUMENT_STYLE = String.raw`
  html {
    --pageroot-review-context-opacity: .39;
    --pageroot-review-context-grayscale: .43;
    --pageroot-review-context-saturation: .77;
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

  html[data-pageroot-review-focus]:not([data-pageroot-review-focus="all"])
    [data-pageroot-outline-id][data-pageroot-review-active="false"] {
    opacity: var(--pageroot-review-context-opacity) !important;
    filter: grayscale(var(--pageroot-review-context-grayscale))
      saturate(var(--pageroot-review-context-saturation)) !important;
  }

  html[data-pageroot-review-focus]:not([data-pageroot-review-focus="all"])
    [data-pageroot-outline-id][data-pageroot-review-active="true"] {
    position: relative !important;
    z-index: 2147480000 !important;
    isolation: isolate !important;
    opacity: 1 !important;
    filter: none !important;
  }

  html[data-pageroot-review-filter="all"] [data-pageroot-review-id],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-types~="text"],
  html[data-pageroot-review-filter="structure"] [data-pageroot-review-types~="structure"],
  html[data-pageroot-review-filter="style"] [data-pageroot-review-types~="style"] {
    position: relative !important;
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed #6258d6 !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-side="before"][data-pageroot-review-filter="text"]
    [data-pageroot-review-types~="text"] {
    outline-color: #c74f4a !important;
  }

  html[data-pageroot-review-side="after"][data-pageroot-review-filter="text"]
    [data-pageroot-review-types~="text"] {
    outline-color: #239467 !important;
  }

  html[data-pageroot-review-filter="structure"] [data-pageroot-review-types~="structure"] {
    outline-color: #6258d6 !important;
  }

  html[data-pageroot-review-filter="style"] [data-pageroot-review-types~="style"] {
    outline-color: #1980aa !important;
  }

  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="removed"] {
    background: transparent !important;
    color: #a13f3b !important;
    text-decoration-line: line-through !important;
    text-decoration-style: dashed !important;
    text-decoration-color: #c74f4a !important;
    text-decoration-thickness: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="added"] {
    background: transparent !important;
    color: #217452 !important;
    text-decoration-line: underline !important;
    text-decoration-style: dashed !important;
    text-decoration-color: #239467 !important;
    text-decoration-thickness: calc(2px * var(--pageroot-review-ui-scale)) !important;
    text-underline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-filter="text"] [data-pageroot-review-text-group] {
    outline: calc(1px * var(--pageroot-review-ui-scale)) dashed rgb(98 88 214 / 54%) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-filter="structure"] [data-pageroot-review-structure] {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed #6258d6 !important;
    outline-offset: calc(3px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-side="before"][data-pageroot-review-filter="structure"]
    [data-pageroot-review-structure] {
    outline-color: #8b65c9 !important;
  }

  html[data-pageroot-review-side="after"][data-pageroot-review-filter="structure"]
    [data-pageroot-review-structure] {
    outline-color: #5b55c9 !important;
  }

  html[data-pageroot-review-filter="style"] [data-pageroot-review-style] {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed #1980aa !important;
    outline-offset: calc(3px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  html[data-pageroot-review-filter]:not([data-pageroot-review-filter="overview"])
    [data-pageroot-review-id][data-pageroot-review-active="true"]::after {
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

type ReviewTextInventory = {
  text: string;
  nodes: Array<{ node: Text; start: number; end: number }>;
};

function reviewTextInventory(element: Element | null): ReviewTextInventory {
  if (!element) return { text: "", nodes: [] };
  const nodes: ReviewTextInventory["nodes"] = [];
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (
          !parent
          || parent.closest("script, style, noscript, template")
          || parent.namespaceURI !== "http://www.w3.org/1999/xhtml"
        ) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let text = "";
  let current = walker.nextNode();
  while (current) {
    const value = current.textContent || "";
    const start = text.length;
    text += value;
    nodes.push({ node: current as Text, start, end: text.length });
    current = walker.nextNode();
  }
  return { text, nodes };
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

function structureSignature(element: Element): string {
  return [element, ...element.querySelectorAll("*")]
    .slice(0, 501)
    .map((child) => {
      const parent = child.parentElement;
      const siblingIndex = child === element || !parent
        ? 0
        : [...parent.children].indexOf(child);
      return `${child.tagName.toLowerCase()}#${child.id || ""}@${siblingIndex}`;
    })
    .join("|");
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

function selectorAppliesToRegion(region: Element, rawSelector: string): boolean {
  const selector = rawSelector.trim();
  if (!selector) return false;
  if (/^(?:\*|:root|html|body)(?:\b|$)/iu.test(selector)) return true;
  const inspectableSelector = selector
    .replace(/::[\w-]+/gu, "")
    .replace(/:(?:active|checked|disabled|enabled|focus|focus-visible|focus-within|hover|link|target|visited)(?:\([^)]*\))?/gu, "")
    .trim();
  if (!inspectableSelector) return true;
  try {
    return region.matches(inspectableSelector) || Boolean(region.querySelector(inspectableSelector));
  } catch {
    return false;
  }
}

function matchingStylesheetSignature(element: Element): string {
  const document = element.ownerDocument;
  const matches: string[] = [];
  document.querySelectorAll("style").forEach((styleElement, styleIndex) => {
    const css = styleElement.textContent || "";
    const ruleMatcher = /([^{}]+)\{([^{}]*)\}/gu;
    for (const match of css.matchAll(ruleMatcher)) {
      const selectorText = match[1].trim();
      if (selectorText.startsWith("@")) continue;
      const selectors = selectorText.split(",");
      if (!selectors.some((selector) => selectorAppliesToRegion(element, selector))) continue;
      matches.push(`${styleIndex}:${normalizedCss(selectorText)}{${normalizedCss(match[2])}}`);
    }
  });
  document.querySelectorAll('link[rel~="stylesheet"]').forEach((link, index) => {
    matches.push(`link:${index}:${link.getAttribute("href") || ""}:${link.getAttribute("media") || ""}`);
  });
  return matches.join("\u001d");
}

function presentationSignature(element: Element): string {
  return [element, ...element.querySelectorAll("*")]
    .slice(0, 501)
    .map(elementVisualSignature)
    .concat(matchingStylesheetSignature(element))
    .join("\u001e");
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
  if (element.hasAttribute("data-tab-panel")) return true;
  return Boolean(element.id) && hasClassRole(element, ["panel", "page", "slide"]);
}

function closestPanelContainer(element: Element): Element | null {
  let candidate: Element | null = element;
  while (candidate && candidate !== element.ownerDocument.body) {
    if (isPanelContainer(candidate)) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
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
  const identity = panel.id
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
  let score = before.tagName === after.tagName ? 14 : -24;
  const beforeContext = regionContextKey(before);
  const afterContext = regionContextKey(after);
  score += beforeContext === afterContext ? 34 : -20;

  const beforeClasses = new Set(classTokens(before));
  const sharedClasses = classTokens(after).filter((token) => beforeClasses.has(token)).length;
  score += Math.min(24, sharedClasses * 8);

  const beforeHeading = conciseElementText(directHeading(before));
  const afterHeading = conciseElementText(directHeading(after));
  if (beforeHeading && afterHeading && beforeHeading === afterHeading) score += 28;
  if (normalizedText(before) === normalizedText(after)) score += 36;
  score += Math.max(0, 9 - Math.abs(beforeIndex - afterIndex));
  return score;
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
  const pairs: SectionPair[] = [];
  const usedAfter = new Set<Element>();
  const afterByKey = new Map<string, Element>();
  after.forEach((element) => {
    const key = pairKey(element);
    if (key && !afterByKey.has(key)) afterByKey.set(key, element);
  });

  before.forEach((beforeElement, index) => {
    const key = pairKey(beforeElement);
    let afterElement = key ? afterByKey.get(key) || null : null;
    if (afterElement && usedAfter.has(afterElement)) afterElement = null;
    if (!afterElement) {
      const ranked = after
        .map((candidate, afterIndex) => ({
          candidate,
          afterIndex,
          score: usedAfter.has(candidate)
            ? Number.NEGATIVE_INFINITY
            : sectionPairScore(beforeElement, candidate, index, afterIndex),
        }))
        .sort((left, right) => right.score - left.score);
      if (ranked[0]?.score >= 20) afterElement = ranked[0].candidate;
    }
    if (afterElement) usedAfter.add(afterElement);
    pairs.push({
      before: beforeElement,
      after: afterElement,
      beforeIndex: index,
      afterIndex: afterElement ? after.indexOf(afterElement) : -1,
    });
  });
  after.forEach((afterElement, index) => {
    if (!usedAfter.has(afterElement)) {
      pairs.push({ before: null, after: afterElement, beforeIndex: -1, afterIndex: index });
    }
  });
  return markMovedPairs(pairs);
}

function changeTypes(pair: SectionPair): ReviewChangeType[] {
  const { before, after } = pair;
  if (!before || !after) return ["text", "structure"];
  const types: ReviewChangeType[] = [];
  if (normalizedText(before) !== normalizedText(after)) types.push("text");
  const structureChanged = pair.moved
    || structureSignature(before) !== structureSignature(after);
  if (structureChanged) types.push("structure");
  if (presentationSignature(before) !== presentationSignature(after)) types.push("style");
  if (!types.length && normalizedMarkup(before) !== normalizedMarkup(after)) {
    types.push("structure");
  }
  return types;
}

function helperText(
  types: ReviewChangeType[],
  beforePresent: boolean,
  afterPresent: boolean,
  pair?: SectionPair,
): string {
  if (!beforePresent) return "AI 候选中新增";
  if (!afterPresent) return "AI 候选中移除";
  if (pair?.moved) {
    const movement = `第 ${pair.beforeIndex + 1} 区移至第 ${pair.afterIndex + 1} 区`;
    const otherLabels = types
      .filter((type) => type !== "structure")
      .map((type) => type === "text" ? "文案" : "视觉");
    return otherLabels.length ? `${movement}，并有${otherLabels.join("、")}变化` : movement;
  }
  const labels = types.map((type) => (
    type === "text" ? "文案" : type === "structure" ? "结构" : "视觉"
  ));
  return `${labels.join("、")}发生变化`;
}

function panelControlLabel(document: Document, panel: Element): string {
  const controls = [...document.querySelectorAll(
    "[aria-controls], [data-p], [data-tab]",
  )];
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

type TextToken = { value: string; start: number; end: number };
type TextRange = { start: number; end: number };

function tokenizeReviewText(value: string): TextToken[] {
  const tokens: TextToken[] = [];
  const matcher = /[\p{Script=Han}]|[\p{L}\p{N}_]+|[^\s]/gu;
  for (const match of value.matchAll(matcher)) {
    const start = match.index ?? 0;
    tokens.push({ value: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

function unmatchedTokenIndexes(
  before: TextToken[],
  after: TextToken[],
): { before: Set<number>; after: Set<number> } {
  const beforeUnmatched = new Set(before.map((_, index) => index));
  const afterUnmatched = new Set(after.map((_, index) => index));
  if (!before.length || !after.length) return { before: beforeUnmatched, after: afterUnmatched };

  if (before.length * after.length > 60_000) {
    let prefix = 0;
    while (
      prefix < before.length
      && prefix < after.length
      && before[prefix].value === after[prefix].value
    ) {
      beforeUnmatched.delete(prefix);
      afterUnmatched.delete(prefix);
      prefix += 1;
    }
    let beforeSuffix = before.length - 1;
    let afterSuffix = after.length - 1;
    while (
      beforeSuffix >= prefix
      && afterSuffix >= prefix
      && before[beforeSuffix].value === after[afterSuffix].value
    ) {
      beforeUnmatched.delete(beforeSuffix);
      afterUnmatched.delete(afterSuffix);
      beforeSuffix -= 1;
      afterSuffix -= 1;
    }
    return { before: beforeUnmatched, after: afterUnmatched };
  }

  const matrix = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  );
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex += 1) {
      matrix[beforeIndex][afterIndex] = before[beforeIndex - 1].value === after[afterIndex - 1].value
        ? matrix[beforeIndex - 1][afterIndex - 1] + 1
        : Math.max(matrix[beforeIndex - 1][afterIndex], matrix[beforeIndex][afterIndex - 1]);
    }
  }
  let beforeIndex = before.length;
  let afterIndex = after.length;
  while (beforeIndex > 0 && afterIndex > 0) {
    if (before[beforeIndex - 1].value === after[afterIndex - 1].value) {
      beforeUnmatched.delete(beforeIndex - 1);
      afterUnmatched.delete(afterIndex - 1);
      beforeIndex -= 1;
      afterIndex -= 1;
    } else if (matrix[beforeIndex - 1][afterIndex] >= matrix[beforeIndex][afterIndex - 1]) {
      beforeIndex -= 1;
    } else {
      afterIndex -= 1;
    }
  }
  return { before: beforeUnmatched, after: afterUnmatched };
}

function rangesForTokens(
  source: string,
  tokens: TextToken[],
  indexes: Set<number>,
): TextRange[] {
  const ranges: TextRange[] = [];
  [...indexes].sort((left, right) => left - right).forEach((index) => {
    const token = tokens[index];
    const previous = ranges.at(-1);
    if (
      previous
      && /^[\s，。；：、,.!?！？:;()[\]{}'"“”‘’\-—]*$/u.test(source.slice(previous.end, token.start))
    ) {
      previous.end = token.end;
    } else {
      ranges.push({ start: token.start, end: token.end });
    }
  });
  return ranges;
}

function reviewSentenceRanges(value: string): TextRange[] {
  if (!value) return [];
  const ranges: TextRange[] = [];
  const boundary = /[。！？!?；;]+|\n+/gu;
  let start = 0;
  for (const match of value.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    if (value.slice(start, end).trim()) ranges.push({ start, end });
    start = end;
  }
  if (value.slice(start).trim()) ranges.push({ start, end: value.length });
  return ranges.length ? ranges : [{ start: 0, end: value.length }];
}

function unmatchedSentenceIndexes(
  beforeText: string,
  beforeRanges: TextRange[],
  afterText: string,
  afterRanges: TextRange[],
): { before: Set<number>; after: Set<number> } {
  const beforeValues = beforeRanges.map((range) => (
    beforeText.slice(range.start, range.end).replace(/\s+/g, " ").trim()
  ));
  const afterValues = afterRanges.map((range) => (
    afterText.slice(range.start, range.end).replace(/\s+/g, " ").trim()
  ));
  const beforeUnmatched = new Set(beforeValues.map((_, index) => index));
  const afterUnmatched = new Set(afterValues.map((_, index) => index));
  if (beforeValues.length * afterValues.length > 40_000) {
    let prefix = 0;
    while (
      prefix < beforeValues.length
      && prefix < afterValues.length
      && beforeValues[prefix] === afterValues[prefix]
    ) {
      beforeUnmatched.delete(prefix);
      afterUnmatched.delete(prefix);
      prefix += 1;
    }
    let beforeSuffix = beforeValues.length - 1;
    let afterSuffix = afterValues.length - 1;
    while (
      beforeSuffix >= prefix
      && afterSuffix >= prefix
      && beforeValues[beforeSuffix] === afterValues[afterSuffix]
    ) {
      beforeUnmatched.delete(beforeSuffix);
      afterUnmatched.delete(afterSuffix);
      beforeSuffix -= 1;
      afterSuffix -= 1;
    }
    return { before: beforeUnmatched, after: afterUnmatched };
  }
  const matrix = Array.from(
    { length: beforeValues.length + 1 },
    () => new Uint16Array(afterValues.length + 1),
  );
  for (let beforeIndex = 1; beforeIndex <= beforeValues.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= afterValues.length; afterIndex += 1) {
      matrix[beforeIndex][afterIndex] = beforeValues[beforeIndex - 1] === afterValues[afterIndex - 1]
        ? matrix[beforeIndex - 1][afterIndex - 1] + 1
        : Math.max(matrix[beforeIndex - 1][afterIndex], matrix[beforeIndex][afterIndex - 1]);
    }
  }
  let beforeIndex = beforeValues.length;
  let afterIndex = afterValues.length;
  while (beforeIndex > 0 && afterIndex > 0) {
    if (beforeValues[beforeIndex - 1] === afterValues[afterIndex - 1]) {
      beforeUnmatched.delete(beforeIndex - 1);
      afterUnmatched.delete(afterIndex - 1);
      beforeIndex -= 1;
      afterIndex -= 1;
    } else if (matrix[beforeIndex - 1][afterIndex] >= matrix[beforeIndex][afterIndex - 1]) {
      beforeIndex -= 1;
    } else {
      afterIndex -= 1;
    }
  }
  return { before: beforeUnmatched, after: afterUnmatched };
}

function mergeTextRanges(ranges: TextRange[]): TextRange[] {
  return [...ranges]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<TextRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}

function sentenceAwareTextDifferences(
  beforeText: string,
  afterText: string,
): { before: TextRange[]; after: TextRange[] } {
  const beforeSentences = reviewSentenceRanges(beforeText);
  const afterSentences = reviewSentenceRanges(afterText);
  const unmatchedSentences = unmatchedSentenceIndexes(
    beforeText,
    beforeSentences,
    afterText,
    afterSentences,
  );
  const beforeIndexes = [...unmatchedSentences.before].sort((left, right) => left - right);
  const afterIndexes = [...unmatchedSentences.after].sort((left, right) => left - right);
  const beforeDifferences: TextRange[] = [];
  const afterDifferences: TextRange[] = [];
  const pairCount = Math.max(beforeIndexes.length, afterIndexes.length);

  for (let index = 0; index < pairCount; index += 1) {
    const beforeRange = beforeSentences[beforeIndexes[index]];
    const afterRange = afterSentences[afterIndexes[index]];
    if (!beforeRange && afterRange) {
      afterDifferences.push(afterRange);
      continue;
    }
    if (beforeRange && !afterRange) {
      beforeDifferences.push(beforeRange);
      continue;
    }
    if (!beforeRange || !afterRange) continue;
    const beforeSentence = beforeText.slice(beforeRange.start, beforeRange.end);
    const afterSentence = afterText.slice(afterRange.start, afterRange.end);
    const beforeTokens = tokenizeReviewText(beforeSentence);
    const afterTokens = tokenizeReviewText(afterSentence);
    const unmatchedTokens = unmatchedTokenIndexes(beforeTokens, afterTokens);
    const matchedCount = Math.min(
      beforeTokens.length - unmatchedTokens.before.size,
      afterTokens.length - unmatchedTokens.after.size,
    );
    const similarity = matchedCount / Math.max(1, beforeTokens.length, afterTokens.length);
    if (similarity < .2) {
      beforeDifferences.push(beforeRange);
      afterDifferences.push(afterRange);
      continue;
    }
    const beforeTokenRanges = rangesForTokens(
      beforeSentence,
      beforeTokens,
      unmatchedTokens.before,
    ).map((range) => ({
      start: beforeRange.start + range.start,
      end: beforeRange.start + range.end,
    }));
    const afterTokenRanges = rangesForTokens(
      afterSentence,
      afterTokens,
      unmatchedTokens.after,
    ).map((range) => ({
      start: afterRange.start + range.start,
      end: afterRange.start + range.end,
    }));
    beforeDifferences.push(...(beforeTokenRanges.length ? beforeTokenRanges : [beforeRange]));
    afterDifferences.push(...(afterTokenRanges.length ? afterTokenRanges : [afterRange]));
  }

  return {
    before: mergeTextRanges(beforeDifferences),
    after: mergeTextRanges(afterDifferences),
  };
}

function wrapTextRanges(
  inventory: ReviewTextInventory,
  ranges: TextRange[],
  tone: "removed" | "added",
) {
  if (!ranges.length) return;
  inventory.nodes.forEach(({ node, start, end }) => {
    const intersections = ranges
      .map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
      .filter((range) => range.end > range.start);
    if (!intersections.length) return;
    const source = node.textContent || "";
    const fragment = node.ownerDocument.createDocumentFragment();
    let cursor = 0;
    intersections.forEach((range) => {
      const localStart = range.start - start;
      const localEnd = range.end - start;
      if (localStart > cursor) fragment.append(source.slice(cursor, localStart));
      const marker = node.ownerDocument.createElement("span");
      marker.dataset.pagerootReviewText = tone;
      marker.textContent = source.slice(localStart, localEnd);
      fragment.append(marker);
      cursor = localEnd;
    });
    if (cursor < source.length) fragment.append(source.slice(cursor));
    node.replaceWith(fragment);
  });
}

function isTextBlock(element: Element): boolean {
  return element.matches(
    "h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td, caption, figcaption, blockquote, label, button, a, summary, [role='heading']",
  ) || hasClassRole(element, ["copy", "heading", "header", "label", "note", "subtitle", "title"]);
}

function reviewTextBlocks(region: Element): Element[] {
  const candidates = [region, ...region.querySelectorAll(
    "h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td, caption, figcaption, blockquote, label, button, a, summary, [role='heading'], [class]",
  )].filter((element) => isTextBlock(element) && normalizedText(element).length > 0);
  const leaves = candidates.filter((candidate) => !candidates.some((possibleChild) => (
    possibleChild !== candidate && candidate.contains(possibleChild)
  )));
  return leaves.length ? leaves : [region];
}

function pairTextBlocks(
  before: Element[],
  after: Element[],
): Array<{ before: Element | null; after: Element | null }> {
  const pairs: Array<{ before: Element | null; after: Element | null }> = [];
  const usedAfter = new Set<Element>();
  const afterByKey = new Map<string, Element>();
  after.forEach((element) => {
    const key = pairKey(element);
    if (key && !afterByKey.has(key)) afterByKey.set(key, element);
  });
  before.forEach((beforeElement, index) => {
    const key = pairKey(beforeElement);
    let afterElement = key ? afterByKey.get(key) || null : null;
    if (!afterElement) {
      const positional = after[index];
      if (positional && positional.tagName === beforeElement.tagName && !usedAfter.has(positional)) {
        afterElement = positional;
      }
    }
    if (!afterElement) {
      afterElement = after.find((candidate) => (
        !usedAfter.has(candidate) && candidate.tagName === beforeElement.tagName
      )) || null;
    }
    if (afterElement) usedAfter.add(afterElement);
    pairs.push({ before: beforeElement, after: afterElement });
  });
  after.forEach((afterElement) => {
    if (!usedAfter.has(afterElement)) pairs.push({ before: null, after: afterElement });
  });
  return pairs;
}

function markAllText(element: Element, tone: "removed" | "added") {
  element.setAttribute("data-pageroot-review-text-group", tone);
  const inventory = reviewTextInventory(element);
  if (inventory.text.length) {
    wrapTextRanges(inventory, [{ start: 0, end: inventory.text.length }], tone);
  }
}

function markTextDifferences(before: Element | null, after: Element | null) {
  if (!before && after) {
    reviewTextBlocks(after).forEach((element) => markAllText(element, "added"));
    return;
  }
  if (before && !after) {
    reviewTextBlocks(before).forEach((element) => markAllText(element, "removed"));
    return;
  }
  if (!before || !after) return;
  pairTextBlocks(reviewTextBlocks(before), reviewTextBlocks(after)).forEach((pair) => {
    if (!pair.before && pair.after) {
      markAllText(pair.after, "added");
      return;
    }
    if (pair.before && !pair.after) {
      markAllText(pair.before, "removed");
      return;
    }
    if (!pair.before || !pair.after) return;
    const beforeInventory = reviewTextInventory(pair.before);
    const afterInventory = reviewTextInventory(pair.after);
    if (beforeInventory.text === afterInventory.text) return;
    pair.before.setAttribute("data-pageroot-review-text-group", "changed");
    pair.after.setAttribute("data-pageroot-review-text-group", "changed");
    const differences = sentenceAwareTextDifferences(
      beforeInventory.text,
      afterInventory.text,
    );
    wrapTextRanges(beforeInventory, differences.before, "removed");
    wrapTextRanges(afterInventory, differences.after, "added");
  });
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
  const pairs: Array<{ before: Element; after: Element }> = [];
  beforeElements.forEach((beforeElement, index) => {
    const key = visualPairKey(beforeElement);
    const keyed = key && afterBuckets.get(key)?.length === 1
      ? afterBuckets.get(key)?.[0] || null
      : null;
    let afterElement = keyed && !usedAfter.has(keyed) ? keyed : null;
    if (!afterElement) {
      const positional = afterElements[index];
      if (
        positional
        && positional.tagName === beforeElement.tagName
        && !usedAfter.has(positional)
      ) afterElement = positional;
    }
    if (!afterElement) {
      const beforeText = beforeElement.childElementCount <= 3
        ? (beforeElement.textContent || "").replace(/\s+/g, " ").trim()
        : "";
      afterElement = afterElements.find((candidate) => (
        !usedAfter.has(candidate)
        && candidate.tagName === beforeElement.tagName
        && beforeText.length > 0
        && candidate.childElementCount <= 3
        && (candidate.textContent || "").replace(/\s+/g, " ").trim() === beforeText
      )) || null;
    }
    if (!afterElement) return;
    usedAfter.add(afterElement);
    pairs.push({ before: beforeElement, after: afterElement });
  });
  return pairs;
}

function markStyleDifferences(before: Element | null, after: Element | null) {
  if (!before || !after) {
    (after || before)?.setAttribute("data-pageroot-review-style", after ? "after" : "before");
    return;
  }
  let marked = 0;
  for (const pair of pairVisualElements(before, after)) {
    if (selfPresentationSignature(pair.before) === selfPresentationSignature(pair.after)) continue;
    pair.before.setAttribute("data-pageroot-review-style", "before");
    pair.after.setAttribute("data-pageroot-review-style", "after");
    marked += 1;
    if (marked >= 40) break;
  }
  if (!marked) {
    before.setAttribute("data-pageroot-review-style", "before");
    after.setAttribute("data-pageroot-review-style", "after");
  }
}

function annotateChangePair(pair: SectionPair, types: ReviewChangeType[]) {
  if (types.includes("text")) markTextDifferences(pair.before, pair.after);
  if (types.includes("structure")) {
    pair.before?.setAttribute(
      "data-pageroot-review-structure",
      pair.afterIndex >= 0 && pair.beforeIndex !== pair.afterIndex ? "from" : "before",
    );
    pair.after?.setAttribute(
      "data-pageroot-review-structure",
      pair.beforeIndex >= 0 && pair.beforeIndex !== pair.afterIndex ? "to" : "after",
    );
  }
  if (types.includes("style")) markStyleDifferences(pair.before, pair.after);
}

function clearReservedReviewMarkup(document: Document) {
  document.getElementById(REVIEW_STYLE_ID)?.remove();
  document.querySelectorAll(`[${REVIEW_BOOTSTRAP_ATTRIBUTE}]`).forEach((element) => element.remove());
  document.querySelectorAll(`base[${REVIEW_BASE_ATTRIBUTE}]`).forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (
        attribute.name.startsWith("data-pageroot-review-")
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

function reviewBootstrap(sessionId: string, side: ReviewSide): string {
  return String.raw`
(() => {
  const sessionId = ${JSON.stringify(sessionId)};
  const side = ${JSON.stringify(side)};
  let suppressScrollUntil = 0;
  let scrollFrame = 0;
  const post = (type, extra = {}) => parent.postMessage({
    source: "pageroot-ai-review",
    sessionId,
    side,
    type,
    ...extra,
  }, "*");
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const documentHeight = () => Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
  );
  const reviewAnchor = () => {
    const elements = [...document.querySelectorAll("[data-pageroot-outline-id]")]
      .filter((element) => element.getBoundingClientRect().height > 0);
    const anchor = elements.find((element) => element.getBoundingClientRect().bottom > 1)
      || elements.at(-1)
      || null;
    const maximumScroll = Math.max(1, documentHeight() - innerHeight);
    if (!anchor) {
      return { outlineId: "", ratio: 0, pageRatio: clamp(scrollY / maximumScroll, 0, 1) };
    }
    const rect = anchor.getBoundingClientRect();
    return {
      outlineId: anchor.getAttribute("data-pageroot-outline-id") || "",
      ratio: clamp((0 - rect.top) / Math.max(1, rect.height), 0, 1),
      pageRatio: clamp(scrollY / maximumScroll, 0, 1),
    };
  };
  const matchingPanelControl = (panel) => {
    const panelId = panel.id
      || panel.getAttribute("data-page")
      || panel.getAttribute("data-tab-panel")
      || "";
    if (!panelId) return null;
    return [...document.querySelectorAll("button, [role='tab'], [aria-controls], [data-p], [data-tab]")]
      .find((candidate) => (
        candidate.getAttribute("aria-controls") === panelId
        || candidate.getAttribute("data-p") === panelId
        || candidate.getAttribute("data-tab") === panelId
        || (panelId.startsWith("p") && candidate.getAttribute("data-p") === panelId.slice(1))
      )) || null;
  };
  const revealTarget = (target) => {
    const details = target.closest("details");
    if (details) details.open = true;
    const ancestors = [];
    let candidate = target;
    while (candidate && candidate !== document.body) {
      if (
        candidate.hasAttribute("hidden")
        || candidate.getAttribute("aria-hidden") === "true"
        || candidate.getAttribute("role") === "tabpanel"
        || candidate.hasAttribute("data-tab-panel")
      ) ancestors.unshift(candidate);
      candidate = candidate.parentElement;
    }
    ancestors.forEach((panel) => {
      const control = matchingPanelControl(panel);
      if (control instanceof HTMLElement) control.click();
      if (panel.hasAttribute("hidden")) panel.removeAttribute("hidden");
      if (panel.getAttribute("aria-hidden") === "true") panel.setAttribute("aria-hidden", "false");
      if (control) {
        control.setAttribute("aria-selected", "true");
        control.setAttribute("aria-expanded", "true");
      }
    });
  };
  const focusTarget = (target, behavior) => {
    if (!target) return;
    revealTarget(target);
    requestAnimationFrame(() => {
      suppressScrollUntil = Date.now() + 360;
      target.scrollIntoView({ block: "start", behavior: behavior === "smooth" ? "smooth" : "auto" });
    });
  };
  const syncScroll = (message) => {
    suppressScrollUntil = Date.now() + 180;
    const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
    const ratio = clamp(Number(message.ratio || 0), 0, 1);
    const pageRatio = clamp(Number(message.pageRatio || 0), 0, 1);
    const target = outlineId
      ? document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]')
      : null;
    let top = pageRatio * Math.max(0, documentHeight() - innerHeight);
    if (target) {
      const rect = target.getBoundingClientRect();
      top = scrollY + rect.top + ratio * Math.max(1, rect.height);
    }
    scrollTo({ top: Math.max(0, top), left: Number(message.left || 0), behavior: "auto" });
  };
  const applyState = (state) => {
    const root = document.documentElement;
    root.dataset.pagerootReviewFilter = state.filter || "overview";
    root.dataset.pagerootReviewFocus = state.focus || "all";
    const transparency = Math.max(0, Math.min(100, Number(state.transparency ?? 22))) / 100;
    root.style.setProperty("--pageroot-review-context-opacity", String(.22 + transparency * .78));
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
  };
  addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source !== "pageroot-ai-review-parent" || message.sessionId !== sessionId) return;
    if (message.type === "state") applyState(message.state || {});
    if (message.type === "sync-scroll") syncScroll(message);
    if (message.type === "focus-change") {
      const changeId = String(message.changeId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-review-id="' + changeId + '"]');
      focusTarget(target, message.behavior);
    }
    if (message.type === "focus-outline") {
      const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]');
      focusTarget(target, message.behavior);
    }
  });
  addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a[href], area[href]")) {
      event.preventDefault();
    }
  }, true);
  addEventListener("submit", (event) => event.preventDefault(), true);
  addEventListener("scroll", () => {
    if (Date.now() < suppressScrollUntil) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      post("scroll", { ...reviewAnchor(), left: scrollX });
    });
  }, { passive: true });
  const announceReady = () => post("ready", {
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  });
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", announceReady, { once: true });
  else announceReady();
})();
`;
}

function prepareDocument(
  document: Document,
  side: ReviewSide,
  sessionId: string,
  sourcePath?: string,
  externalBootstrap = false,
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
  document.documentElement.dataset.pagerootReviewFilter = "overview";
  document.documentElement.dataset.pagerootReviewFocus = "all";

  const style = document.createElement("style");
  style.id = REVIEW_STYLE_ID;
  style.textContent = REVIEW_DOCUMENT_STYLE;

  const bootstrap = document.createElement("script");
  bootstrap.setAttribute(REVIEW_BOOTSTRAP_ATTRIBUTE, "true");
  const bootstrapJavaScript = reviewBootstrap(sessionId, side);
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
    };
  }
  const parser = new DOMParser();
  const beforeDocument = parser.parseFromString(beforeHtml, "text/html");
  const afterDocument = parser.parseFromString(afterHtml, "text/html");
  clearReservedReviewMarkup(beforeDocument);
  clearReservedReviewMarkup(afterDocument);
  const pairs = pairSections(
    candidateSections(beforeDocument),
    candidateSections(afterDocument),
  );
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];

  pairs.forEach((pair, pairIndex) => {
    const outlineId = `outline-${outline.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const types = changeTypes(pair);
    const changeId = types.length ? `change-${changes.length + 1}` : undefined;
    const helper = types.length
      ? helperText(types, Boolean(pair.before), Boolean(pair.after), pair)
      : "本轮未修改";
    const movement = pair.moved
      ? { from: pair.beforeIndex + 1, to: pair.afterIndex + 1 }
      : undefined;
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
      annotateChangePair(pair, types);
      changes.push({
        id: changeId,
        label,
        helper,
        types,
        beforePresent: Boolean(pair.before),
        afterPresent: Boolean(pair.after),
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
      ...(movement ? { movement } : {}),
    });
  });

  if (!changes.length && beforeHtml !== afterHtml) {
    const beforeBody = beforeDocument.body;
    const afterBody = afterDocument.body;
    const outlineId = "outline-full-page";
    outline.splice(0, outline.length);
    [beforeDocument, afterDocument].forEach((document) => {
      document.querySelectorAll("[data-pageroot-outline-id]").forEach((element) => {
        element.removeAttribute("data-pageroot-outline-id");
        element.removeAttribute("data-pageroot-review-active");
      });
    });
    [beforeBody, afterBody].forEach((element) => {
      element.setAttribute("data-pageroot-outline-id", outlineId);
      element.setAttribute("data-pageroot-review-id", "change-1");
      element.setAttribute("data-pageroot-review-active", "false");
      element.setAttribute("data-pageroot-review-types", "text structure style");
      element.setAttribute("data-pageroot-review-summary", "整页内容发生变化");
    });
    annotateChangePair(
      { before: beforeBody, after: afterBody, beforeIndex: 0, afterIndex: 0 },
      ["text", "structure", "style"],
    );
    changes.push({
      id: "change-1",
      label: "完整页面",
      helper: "整页内容发生变化",
      types: ["text", "structure", "style"],
      beforePresent: true,
      afterPresent: true,
    });
    outline.push({
      id: outlineId,
      group: "完整页面",
      label: "完整页面",
      helper: "整页内容发生变化",
      changeId: "change-1",
      types: ["text", "structure", "style"],
    });
  }

  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
  );
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
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
  };
}
