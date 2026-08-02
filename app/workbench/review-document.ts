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
};

export type ReviewOutlineItem = {
  id: string;
  group: string;
  label: string;
  helper: string;
  changeId?: string;
  types: ReviewChangeType[];
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

  html[data-pageroot-review-filter="all"] [data-pageroot-review-text="removed"],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="removed"] {
    padding: 0 calc(1px * var(--pageroot-review-ui-scale)) !important;
    border-radius: calc(3px * var(--pageroot-review-ui-scale)) !important;
    background: #fff0ef !important;
    color: #a13f3b !important;
    text-decoration-line: line-through !important;
    text-decoration-style: dashed !important;
    text-decoration-color: #c74f4a !important;
    text-decoration-thickness: calc(2px * var(--pageroot-review-ui-scale)) !important;
  }

  html[data-pageroot-review-filter="all"] [data-pageroot-review-text="added"],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="added"] {
    padding: 0 calc(1px * var(--pageroot-review-ui-scale)) !important;
    border-radius: calc(3px * var(--pageroot-review-ui-scale)) !important;
    background: #eaf8f1 !important;
    color: #217452 !important;
    text-decoration: none !important;
    box-shadow: inset 0 calc(-2px * var(--pageroot-review-ui-scale)) 0 rgb(35 148 103 / 38%) !important;
  }

  html[data-pageroot-review-filter="all"] [data-pageroot-review-structure],
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

  html[data-pageroot-review-filter="all"] [data-pageroot-review-style],
  html[data-pageroot-review-filter="style"] [data-pageroot-review-style] {
    outline: calc(2px * var(--pageroot-review-ui-scale)) solid #1980aa !important;
    outline-offset: calc(3px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: 0 0 0 calc(4px * var(--pageroot-review-ui-scale)) rgb(25 128 170 / 10%) !important;
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
  return [...element.querySelectorAll("*")]
    .slice(0, 500)
    .map((child) => `${child.tagName.toLowerCase()}#${child.id || ""}`)
    .join("|");
}

function presentationSignature(element: Element): string {
  return [element, ...element.querySelectorAll("*")]
    .slice(0, 501)
    .map((candidate) => [
      candidate.getAttribute("class") || "",
      candidate.getAttribute("style") || "",
      candidate.getAttribute("hidden") || "",
      candidate.getAttribute("width") || "",
      candidate.getAttribute("height") || "",
      candidate.getAttribute("data-state") || "",
    ].join("\u001f"))
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
  const label = conciseElementText(heading)
    || preferred?.getAttribute("aria-label")
    || preferred?.getAttribute("data-title")
    || preferred?.id
    || conciseElementText(preferred)
    || `页面区域 ${index + 1}`;
  return label.length > 72 ? `${label.slice(0, 72)}…` : label;
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
};

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
  return pairs;
}

function changeTypes(before: Element | null, after: Element | null): ReviewChangeType[] {
  if (!before || !after) return ["text", "structure"];
  const types: ReviewChangeType[] = [];
  if (normalizedText(before) !== normalizedText(after)) types.push("text");
  const structureChanged = structureSignature(before) !== structureSignature(after);
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
): string {
  if (!beforePresent) return "AI 候选中新增";
  if (!afterPresent) return "AI 候选中移除";
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
    const beforeTokens = tokenizeReviewText(beforeInventory.text);
    const afterTokens = tokenizeReviewText(afterInventory.text);
    const unmatched = unmatchedTokenIndexes(beforeTokens, afterTokens);
    wrapTextRanges(
      beforeInventory,
      rangesForTokens(beforeInventory.text, beforeTokens, unmatched.before),
      "removed",
    );
    wrapTextRanges(
      afterInventory,
      rangesForTokens(afterInventory.text, afterTokens, unmatched.after),
      "added",
    );
  });
}

function selfPresentationSignature(element: Element): string {
  return [
    element.getAttribute("class") || "",
    element.getAttribute("style") || "",
    element.getAttribute("hidden") || "",
    element.getAttribute("width") || "",
    element.getAttribute("height") || "",
    element.getAttribute("data-state") || "",
    element.getAttribute("aria-hidden") || "",
  ].join("\u001f");
}

function markStyleDifferences(before: Element | null, after: Element | null) {
  if (!before || !after) {
    (after || before)?.setAttribute("data-pageroot-review-style", after ? "after" : "before");
    return;
  }
  const beforeElements = [before, ...before.querySelectorAll("*")];
  const afterElements = [after, ...after.querySelectorAll("*")];
  let marked = 0;
  for (let index = 0; index < Math.min(beforeElements.length, afterElements.length); index += 1) {
    const beforeElement = beforeElements[index];
    const afterElement = afterElements[index];
    if (
      beforeElement.tagName !== afterElement.tagName
      || selfPresentationSignature(beforeElement) === selfPresentationSignature(afterElement)
    ) continue;
    beforeElement.setAttribute("data-pageroot-review-style", "before");
    afterElement.setAttribute("data-pageroot-review-style", "after");
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
  const post = (type, extra = {}) => parent.postMessage({
    source: "pageroot-ai-review",
    sessionId,
    side,
    type,
    ...extra,
  }, "*");
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
    if (message.type === "scroll-to") {
      suppressScrollUntil = Date.now() + 180;
      scrollTo({ top: Number(message.top || 0), left: Number(message.left || 0), behavior: "auto" });
    }
    if (message.type === "focus-change") {
      const changeId = String(message.changeId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-review-id="' + changeId + '"]');
      if (target) {
        suppressScrollUntil = Date.now() + 360;
        target.scrollIntoView({ block: "start", behavior: message.behavior === "smooth" ? "smooth" : "auto" });
      }
    }
    if (message.type === "focus-outline") {
      const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]');
      if (target) {
        suppressScrollUntil = Date.now() + 360;
        target.scrollIntoView({ block: "start", behavior: message.behavior === "smooth" ? "smooth" : "auto" });
      }
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
    post("scroll", { top: scrollY, left: scrollX });
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
    const unchanged = Boolean(
      pair.before
      && pair.after
      && normalizedMarkup(pair.before) === normalizedMarkup(pair.after),
    );
    const types = unchanged ? [] : changeTypes(pair.before, pair.after);
    const changeId = types.length ? `change-${changes.length + 1}` : undefined;
    const helper = types.length
      ? helperText(types, Boolean(pair.before), Boolean(pair.after))
      : "本轮未修改";
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
