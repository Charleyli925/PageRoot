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
  movement?: { from: number; to: number };
};

export type ReviewOutlineItem = {
  id: string;
  group: string;
  label: string;
  helper: string;
  changeId?: string;
  panelKey?: string;
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

  [data-pageroot-review-overlay-box][data-active="true"]::after {
    position: absolute !important;
    right: 0 !important;
    bottom: calc(100% + 4px) !important;
    max-width: min(320px, calc(100vw - 24px)) !important;
    padding: calc(3px * var(--pageroot-review-ui-scale)) calc(7px * var(--pageroot-review-ui-scale)) !important;
    overflow: hidden !important;
    border: 1px solid rgb(98 88 214 / 24%) !important;
    border-radius: calc(6px * var(--pageroot-review-ui-scale)) !important;
    background: rgb(255 255 255 / 94%) !important;
    color: #514ba9 !important;
    box-shadow: 0 4px 12px rgb(30 25 70 / 12%) !important;
    content: attr(data-summary) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: calc(10px * var(--pageroot-review-ui-scale)) !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
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
    if (isPanelContainer(candidate)) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

function safePanelControls(document: Document): Element[] {
  const explicit = [...document.querySelectorAll(
    '[role="tab"], button[aria-controls], button[data-p], button[data-tab]',
  )];
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
  index: number;
};

function panelDescriptors(document: Document): PanelDescriptor[] {
  const panels = [...document.querySelectorAll("body *")].filter(isPanelContainer);
  const controls = safePanelControls(document);
  return panels.map((panel, index) => {
    const control = controls.find((candidate) => controlMatchesPanel(candidate, panel))
      || (controls.length === panels.length ? controls[index] : null);
    return {
      panel,
      control,
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
  descriptor.control?.setAttribute("data-pageroot-review-panel-key", key);
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

function panelKeyForElement(element: Element | null): string | undefined {
  if (!element) return undefined;
  return closestPanelContainer(element)
    ?.getAttribute("data-pageroot-review-panel-key") || undefined;
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

function helperText(
  types: ReviewChangeType[],
  beforePresent: boolean,
  afterPresent: boolean,
  pair?: SectionPair,
): string {
  if (!beforePresent) return "新增内容";
  if (!afterPresent) return "删除内容";
  if (pair?.moved && types.length === 1 && types[0] === "structure") return "结构变化";
  const labels = types.map((type) => (
    type === "text" ? "文案" : type === "structure" ? "结构" : "视觉"
  ));
  return `${[...new Set(labels)].join("、")}变化`;
}

function panelControlLabel(document: Document, panel: Element): string {
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

function reviewTextSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = tokenizeReviewText(left);
  const rightTokens = tokenizeReviewText(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const unmatched = unmatchedTokenIndexes(leftTokens, rightTokens);
  const matched = Math.min(
    leftTokens.length - unmatched.before.size,
    rightTokens.length - unmatched.after.size,
  );
  return matched / Math.max(leftTokens.length, rightTokens.length);
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
  const boundary = /[。！？!?；;，,、：:]+|\n+/gu;
  let start = 0;
  const pushRange = (rangeStart: number, rangeEnd: number) => {
    let cursor = rangeStart;
    while (rangeEnd - cursor > 96) {
      const preferredBreak = value.slice(cursor, cursor + 96).search(/\s+(?=\S+$)/u);
      const end = preferredBreak >= 36 ? cursor + preferredBreak + 1 : cursor + 96;
      if (value.slice(cursor, end).trim()) ranges.push({ start: cursor, end });
      cursor = end;
    }
    if (value.slice(cursor, rangeEnd).trim()) ranges.push({ start: cursor, end: rangeEnd });
  };
  for (const match of value.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    pushRange(start, end);
    start = end;
  }
  pushRange(start, value.length);
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
  const sentencePairs = beforeIndexes.flatMap((beforeIndex) => afterIndexes.map((afterIndex) => {
    const beforeRange = beforeSentences[beforeIndex];
    const afterRange = afterSentences[afterIndex];
    const similarity = reviewTextSimilarity(
      beforeText.slice(beforeRange.start, beforeRange.end),
      afterText.slice(afterRange.start, afterRange.end),
    );
    const orderDistance = Math.abs(
      beforeIndexes.indexOf(beforeIndex) - afterIndexes.indexOf(afterIndex),
    );
    return { beforeIndex, afterIndex, similarity, orderDistance };
  })).filter((pair) => pair.similarity >= .28)
    .sort((left, right) => (
      right.similarity - left.similarity || left.orderDistance - right.orderDistance
    ));
  const pairedBefore = new Set<number>();
  const pairedAfter = new Set<number>();
  sentencePairs.forEach((pair) => {
    if (pairedBefore.has(pair.beforeIndex) || pairedAfter.has(pair.afterIndex)) return;
    pairedBefore.add(pair.beforeIndex);
    pairedAfter.add(pair.afterIndex);
    const beforeRange = beforeSentences[pair.beforeIndex];
    const afterRange = afterSentences[pair.afterIndex];
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
      return;
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
  });
  beforeIndexes.forEach((index) => {
    if (!pairedBefore.has(index)) beforeDifferences.push(beforeSentences[index]);
  });
  afterIndexes.forEach((index) => {
    if (!pairedAfter.has(index)) afterDifferences.push(afterSentences[index]);
  });

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
  const mergedRanges = mergeTextRanges(ranges);
  inventory.nodes.forEach(({ node, start, end }) => {
    const intersections = mergedRanges
      .map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
      .filter((range) => range.end > range.start);
    if (!intersections.length) return;
    const source = node.textContent || "";
    const fragment = node.ownerDocument.createDocumentFragment();
    const appendDifference = (value: string) => {
      if (!value) return;
      const marker = node.ownerDocument.createElement("span");
      marker.dataset.pagerootReviewText = tone;
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
      appendDifference(source.slice(localStart, localEnd));
      cursor = localEnd;
    });
    if (cursor < source.length) {
      fragment.append(source.slice(cursor));
    }
    node.replaceWith(fragment);
  });
}

function isTextBlock(element: Element): boolean {
  return element.matches(
    "h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td, caption, figcaption, blockquote, label, button, a, summary, [role='heading']",
  ) || hasClassRole(element, ["copy", "heading", "header", "label", "note", "subtitle", "title"]);
}

function isLeafInlineText(element: Element): boolean {
  return element.childElementCount === 0
    && element.matches("span, strong, em, b, i, small, code, data, output, time")
    && normalizedText(element).length > 0;
}

const GENERIC_TEXT_CONTAINER_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "DIV",
  "FOOTER",
  "HEADER",
  "SECTION",
]);

function hasDirectReviewText(element: Element): boolean {
  return GENERIC_TEXT_CONTAINER_TAGS.has(element.tagName)
    && [...element.childNodes].some((node) => (
      node.nodeType === 3 && Boolean((node.textContent || "").replace(/\s+/gu, "").trim())
    ));
}

function reviewTextBlocks(region: Element): Element[] {
  const explicitBlockSelector = "h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td, caption, figcaption, blockquote, label, button, summary, span, strong, em, b, i, small, code, data, output, time, [role='heading']";
  const candidates = [region, ...region.querySelectorAll("*")].filter((element) => (
    !NON_CONTENT_TAGS.has(element.tagName)
    && normalizedText(element).length > 0
    && (isTextBlock(element) || isLeafInlineText(element) || hasDirectReviewText(element))
    && (
      !GENERIC_TEXT_CONTAINER_TAGS.has(element.tagName)
      || !element.querySelector(explicitBlockSelector)
    )
  ));
  const blocks = candidates.filter((candidate) => !candidates.some((possibleParent) => (
    possibleParent !== candidate
    && possibleParent.contains(candidate)
    && !GENERIC_TEXT_CONTAINER_TAGS.has(possibleParent.tagName)
  )));
  return blocks.length ? blocks : [region];
}

function pairTextBlocks(
  before: Element[],
  after: Element[],
): Array<{ before: Element | null; after: Element | null }> {
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

  before.forEach((beforeElement) => {
    if (assignments.has(beforeElement)) return;
    const beforeText = normalizedText(beforeElement);
    const exact = after
      .map((candidate, afterIndex) => ({ candidate, afterIndex }))
      .filter(({ candidate }) => (
        !usedAfter.has(candidate)
        && candidate.tagName === beforeElement.tagName
        && normalizedText(candidate) === beforeText
      ))
      .sort((left, right) => (
        Math.abs(before.indexOf(beforeElement) - left.afterIndex)
        - Math.abs(before.indexOf(beforeElement) - right.afterIndex)
      ))[0]?.candidate;
    if (!exact) return;
    assignments.set(beforeElement, exact);
    usedAfter.add(exact);
  });

  const edges = before.flatMap((beforeElement, beforeIndex) => (
    assignments.has(beforeElement) || pairKey(beforeElement)
      ? []
      : after.map((candidate, afterIndex) => {
        if (
          usedAfter.has(candidate)
          || pairKey(candidate)
          || candidate.tagName !== beforeElement.tagName
        ) return null;
        const similarity = reviewTextSimilarity(
          reviewTextInventory(beforeElement).text,
          reviewTextInventory(candidate).text,
        );
        if (similarity < .5) return null;
        return {
          beforeElement,
          candidate,
          score: similarity * 100 + Math.max(0, 12 - Math.abs(beforeIndex - afterIndex) * 2),
        };
      }).filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
  )).sort((left, right) => right.score - left.score);
  edges.forEach(({ beforeElement, candidate }) => {
    if (assignments.has(beforeElement) || usedAfter.has(candidate)) return;
    assignments.set(beforeElement, candidate);
    usedAfter.add(candidate);
  });

  const pairs: Array<{ before: Element | null; after: Element | null }> = before.map((beforeElement) => ({
    before: beforeElement,
    after: assignments.get(beforeElement) || null,
  }));
  after.forEach((afterElement) => {
    if (!usedAfter.has(afterElement)) pairs.push({ before: null, after: afterElement });
  });
  return pairs;
}

function markAllText(element: Element, tone: "removed" | "added"): boolean {
  const inventory = reviewTextInventory(element);
  if (!inventory.text.trim()) return false;
  element.setAttribute("data-pageroot-review-text-group", tone);
  wrapTextRanges(inventory, [{ start: 0, end: inventory.text.length }], tone);
  return true;
}

function markTextDifferences(before: Element | null, after: Element | null): boolean {
  let changed = false;
  if (!before && after) {
    reviewTextBlocks(after).forEach((element) => {
      changed = markAllText(element, "added") || changed;
    });
    return changed;
  }
  if (before && !after) {
    reviewTextBlocks(before).forEach((element) => {
      changed = markAllText(element, "removed") || changed;
    });
    return changed;
  }
  if (!before || !after) return false;
  pairTextBlocks(reviewTextBlocks(before), reviewTextBlocks(after)).forEach((pair) => {
    if (!pair.before && pair.after) {
      changed = markAllText(pair.after, "added") || changed;
      return;
    }
    if (pair.before && !pair.after) {
      changed = markAllText(pair.before, "removed") || changed;
      return;
    }
    if (!pair.before || !pair.after) return;
    const beforeInventory = reviewTextInventory(pair.before);
    const afterInventory = reviewTextInventory(pair.after);
    if (beforeInventory.text === afterInventory.text) return;
    const differences = sentenceAwareTextDifferences(
      beforeInventory.text,
      afterInventory.text,
    );
    if (differences.before.length) {
      pair.before.setAttribute("data-pageroot-review-text-group", "changed");
      wrapTextRanges(beforeInventory, differences.before, "removed");
      changed = true;
    }
    if (differences.after.length) {
      pair.after.setAttribute("data-pageroot-review-text-group", "changed");
      wrapTextRanges(afterInventory, differences.after, "added");
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
      const beforeChildren = eligibleChildren(beforeParent);
      const afterChildren = eligibleChildren(afterParent);
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
  for (const pair of pairVisualElements(before, after)) {
    if (selfPresentationSignature(pair.before) === selfPresentationSignature(pair.after)) continue;
    pair.before.setAttribute("data-pageroot-review-style", "before");
    pair.after.setAttribute("data-pageroot-review-style", "after");
    marked += 1;
    if (marked >= 40) break;
  }
  const changedRules = changedStylesheetSelectors(before.ownerDocument, after.ownerDocument);
  changedRules.forEach(({ selector }) => {
    selector.split(",").forEach((part) => {
      const beforeMatches = elementsMatchingSelector(before, part).slice(0, 40);
      const afterMatches = elementsMatchingSelector(after, part).slice(0, 40);
      pairSiblingElements(beforeMatches, afterMatches).forEach((afterElement, beforeElement) => {
        beforeElement.setAttribute("data-pageroot-review-style", "before");
        afterElement.setAttribute("data-pageroot-review-style", "after");
        marked += 1;
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
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    const markerElements = [root, ...root.querySelectorAll("*")].filter((element) => (
      element.hasAttribute("data-pageroot-review-text-group")
      || element.hasAttribute("data-pageroot-review-structure")
      || element.hasAttribute("data-pageroot-review-style")
    ));
    markerElements.forEach((element, index) => {
      const markerTypes: ReviewChangeType[] = [];
      if (element.hasAttribute("data-pageroot-review-text-group")) markerTypes.push("text");
      if (element.hasAttribute("data-pageroot-review-structure")) markerTypes.push("structure");
      if (element.hasAttribute("data-pageroot-review-style")) markerTypes.push("style");
      element.setAttribute("data-pageroot-review-marker", changeId);
      element.setAttribute("data-pageroot-review-marker-types", markerTypes.join(" "));
      element.setAttribute("data-pageroot-review-summary", helper);
      element.setAttribute("data-pageroot-review-active", "false");
      if (index === 0) element.setAttribute("data-pageroot-review-primary", "true");
    });
  });
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
  let scrollFrame = 0;
  let overlayFrame = 0;
  let programmaticScrollToken = "";
  let programmaticScrollTop = 0;
  let mirroringPanel = false;
  let mirroringAction = false;
  let currentState = { filter: "all", focus: "all", transparency: 18, scale: 1 };
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
  const safeKey = (value) => String(value || "").replace(/[^a-z0-9-]/gi, "");
  const isSafePanelControl = (element) => element instanceof Element && element.matches(
    '[role="tab"], button[aria-controls], button[data-p], button[data-tab]',
  );
  const panelControlForKey = (panelKey) => [...document.querySelectorAll(
    '[role="tab"][data-pageroot-review-panel-key], button[aria-controls][data-pageroot-review-panel-key], button[data-p][data-pageroot-review-panel-key], button[data-tab][data-pageroot-review-panel-key]',
  )].find((candidate) => candidate.getAttribute("data-pageroot-review-panel-key") === panelKey) || null;
  const panelForKey = (panelKey) => [...document.querySelectorAll(
    '[data-pageroot-review-panel-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-pageroot-review-panel-key") === panelKey
    && !isSafePanelControl(candidate)
  )) || null;
  const actionForKey = (actionKey) => [...document.querySelectorAll(
    '[data-pageroot-review-action-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-pageroot-review-action-key") === actionKey
  )) || null;
  const scheduleOverlayRender = () => {
    cancelAnimationFrame(overlayFrame);
    overlayFrame = requestAnimationFrame(renderReviewOverlays);
  };
  const activatePanelKey = (rawPanelKey) => {
    const panelKey = safeKey(rawPanelKey);
    if (!panelKey) return;
    const control = panelControlForKey(panelKey);
    const panel = panelForKey(panelKey);
    if (control instanceof HTMLElement) {
      mirroringPanel = true;
      control.click();
      queueMicrotask(() => { mirroringPanel = false; });
    }
    if (panel instanceof HTMLElement) {
      panel.hidden = false;
      panel.removeAttribute("hidden");
      panel.setAttribute("aria-hidden", "false");
    }
    document.querySelectorAll('[data-pageroot-review-panel-key]').forEach((candidate) => {
      if (!isSafePanelControl(candidate)) return;
      const active = candidate.getAttribute("data-pageroot-review-panel-key") === panelKey;
      candidate.setAttribute("aria-selected", active ? "true" : "false");
      candidate.setAttribute("aria-expanded", active ? "true" : "false");
    });
    requestAnimationFrame(scheduleOverlayRender);
  };
  const mirrorAction = (message) => {
    const actionKey = safeKey(message.actionKey);
    if (!actionKey) return;
    let action = actionForKey(actionKey);
    const actionActivatesRequestedPanel = action
      && isSafePanelControl(action)
      && action.getAttribute("data-pageroot-review-panel-key") === safeKey(message.panelKey);
    if (message.panelKey && !actionActivatesRequestedPanel) activatePanelKey(message.panelKey);
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
  const reviewAnchor = () => {
    const elements = [...document.querySelectorAll("[data-pageroot-outline-id]")]
      .filter((element) => element.getBoundingClientRect().height > 0);
    const anchor = elements.find((element) => element.getBoundingClientRect().bottom > 1)
      || elements.at(-1)
      || null;
    const maximumScroll = Math.max(1, documentHeight() - innerHeight);
    const boundary = scrollY <= 1
      ? "top"
      : maximumScroll - scrollY <= 1
        ? "bottom"
        : "middle";
    if (!anchor) {
      return { outlineId: "", ratio: 0, pageRatio: clamp(scrollY / maximumScroll, 0, 1), boundary };
    }
    const rect = anchor.getBoundingClientRect();
    return {
      outlineId: anchor.getAttribute("data-pageroot-outline-id") || "",
      ratio: clamp((0 - rect.top) / Math.max(1, rect.height), 0, 1),
      pageRatio: clamp(scrollY / maximumScroll, 0, 1),
      boundary,
    };
  };
  const matchingPanelControl = (panel) => {
    const panelKey = panel.getAttribute("data-pageroot-review-panel-key") || "";
    if (panelKey) return panelControlForKey(panelKey);
    const panelId = panel.id
      || panel.getAttribute("data-page")
      || panel.getAttribute("data-tab-panel")
      || "";
    if (!panelId) return null;
    return [...document.querySelectorAll('[role="tab"], button[aria-controls], button[data-p], button[data-tab]')]
      .find((candidate) => (
        candidate.getAttribute("aria-controls") === panelId
        || candidate.getAttribute("data-p") === panelId
        || candidate.getAttribute("data-tab") === panelId
        || (panelId.startsWith("p") && candidate.getAttribute("data-p") === panelId.slice(1))
      )) || null;
  };
  const revealTarget = (target, requestedPanelKey) => {
    if (requestedPanelKey) activatePanelKey(requestedPanelKey);
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
  const releaseProgrammaticScroll = (token) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (programmaticScrollToken === token) programmaticScrollToken = "";
    })));
  };
  const focusTarget = (target, panelKey) => {
    revealTarget(target, panelKey);
    if (!target) return;
    requestAnimationFrame(() => {
      const token = "focus-" + Date.now() + "-" + Math.random();
      programmaticScrollToken = token;
      target.scrollIntoView({ block: "start", behavior: "auto" });
      programmaticScrollTop = scrollY;
      releaseProgrammaticScroll(token);
      scheduleOverlayRender();
    });
  };
  const syncScroll = (message) => {
    const token = safeKey(message.syncToken) || ("sync-" + Date.now());
    programmaticScrollToken = token;
    const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
    const ratio = clamp(Number(message.ratio || 0), 0, 1);
    const pageRatio = clamp(Number(message.pageRatio || 0), 0, 1);
    const target = outlineId
      ? document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]')
      : null;
    const maximumScroll = Math.max(0, documentHeight() - innerHeight);
    let top = pageRatio * maximumScroll;
    if (message.boundary === "top") {
      top = 0;
    } else if (message.boundary === "bottom") {
      top = maximumScroll;
    } else if (target) {
      const rect = target.getBoundingClientRect();
      top = scrollY + rect.top + ratio * Math.max(1, rect.height);
    }
    programmaticScrollTop = clamp(top, 0, maximumScroll);
    scrollTo({ top: programmaticScrollTop, left: Number(message.left || 0), behavior: "auto" });
    releaseProgrammaticScroll(token);
  };
  const markerTypes = (element) => String(
    element.getAttribute("data-pageroot-review-marker-types") || "",
  ).split(/\s+/).filter(Boolean);
  const recordsAreClose = (left, right, gap = 10) => {
    const horizontalOverlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const verticalOverlap = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const minimumWidth = Math.max(1, Math.min(left.right - left.left, right.right - right.left));
    const minimumHeight = Math.max(1, Math.min(left.bottom - left.top, right.bottom - right.top));
    const horizontalGap = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
    const verticalGap = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
    return (horizontalOverlap > 0 && verticalOverlap > 0)
      || (verticalGap <= gap && horizontalOverlap / minimumWidth >= .35)
      || (horizontalGap <= gap && verticalOverlap / minimumHeight >= .35);
  };
  const mergeRecordGroup = (records) => ({
    ...records[0],
    left: Math.min(...records.map((record) => record.left)),
    top: Math.min(...records.map((record) => record.top)),
    right: Math.max(...records.map((record) => record.right)),
    bottom: Math.max(...records.map((record) => record.bottom)),
    types: [...new Set(records.flatMap((record) => record.types))],
    tones: [...new Set(records.flatMap((record) => record.tones))],
  });
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
  const allModeSummary = (types) => {
    const labels = [];
    if (types.includes("text")) labels.push("文案");
    if (types.includes("structure")) labels.push("结构");
    if (types.includes("style")) labels.push("视觉");
    return labels.length ? labels.join("、") + "变化" : "变化";
  };
  const recordsOverlapStrongly = (left, right) => {
    const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const intersection = width * height;
    const leftArea = Math.max(1, (left.right - left.left) * (left.bottom - left.top));
    const rightArea = Math.max(1, (right.right - right.left) * (right.bottom - right.top));
    return intersection / Math.min(leftArea, rightArea) >= .62;
  };
  function renderReviewOverlays() {
    document.querySelector('[data-pageroot-review-projection-layer]')?.remove();
    const filter = currentState.filter || "all";
    const records = [];
    if (filter === "all" || filter === "text") {
      document.querySelectorAll('[data-pageroot-review-text-group]').forEach((group) => {
        group.querySelectorAll('[data-pageroot-review-text]').forEach((element) => {
          const textTone = element.getAttribute("data-pageroot-review-text") === "removed"
            ? "text-removed"
            : "text-added";
          [...element.getClientRects()]
            .filter((rect) => rect.width > 1 && rect.height > 1)
            .forEach((rect) => records.push({
              changeId: group.getAttribute("data-pageroot-review-marker") || "",
              summary: group.getAttribute("data-pageroot-review-summary") || "",
              tone: textTone,
              tones: [textTone],
              types: ["text"],
              left: rect.left + scrollX,
              top: rect.top + scrollY,
              right: rect.right + scrollX,
              bottom: rect.bottom + scrollY,
            }));
        });
      });
    }
    const selector = filter === "all"
      ? '[data-pageroot-review-marker-types~="structure"], [data-pageroot-review-marker-types~="style"]'
      : filter === "text"
        ? ""
        : '[data-pageroot-review-marker-types~="' + filter + '"]';
    if (selector) [...document.querySelectorAll(selector)]
      .forEach((element) => {
        const rect = element.getBoundingClientRect();
        const types = markerTypes(element).filter((type) => filter === "all" || type === filter);
        types.forEach((type) => records.push({
          changeId: element.getAttribute("data-pageroot-review-marker") || "",
          summary: element.getAttribute("data-pageroot-review-summary") || "",
          tone: type,
          tones: [type],
          types: [type],
          left: rect.left + scrollX,
          top: rect.top + scrollY,
          right: rect.right + scrollX,
          bottom: rect.bottom + scrollY,
        }));
      });
    const visibleRecords = records
      .filter((rect) => rect.right - rect.left > 1 && rect.bottom - rect.top > 1)
      .sort((left, right) => left.changeId.localeCompare(right.changeId) || left.top - right.top || left.left - right.left);
    const minimalRecords = visibleRecords.filter((record, index) => !visibleRecords.some((candidate, candidateIndex) => {
      if (index === candidateIndex || record.changeId !== candidate.changeId || record.tone !== candidate.tone) return false;
      const recordArea = (record.right - record.left) * (record.bottom - record.top);
      const candidateArea = (candidate.right - candidate.left) * (candidate.bottom - candidate.top);
      return candidateArea < recordArea * .86
        && candidate.left >= record.left - 2
        && candidate.top >= record.top - 2
        && candidate.right <= record.right + 2
        && candidate.bottom <= record.bottom + 2;
    }));
    let merged = mergeConnectedRecords(minimalRecords, (left, right) => (
      left.changeId === right.changeId
      && left.tone === right.tone
      && recordsAreClose(left, right)
    ));
    if (filter === "all") {
      merged = mergeConnectedRecords(merged, (left, right) => (
        left.changeId === right.changeId && recordsOverlapStrongly(left, right)
      )).map((record) => ({
        ...record,
        tone: record.tones.length > 1 ? "mixed" : record.tones[0],
        summary: allModeSummary(record.types),
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
      const hole = document.createElementNS(namespace, "rect");
      hole.setAttribute("data-pageroot-review-mask-hole", record.changeId);
      const left = record.left - inset;
      const top = record.top - inset;
      const width = record.right - record.left + inset * 2;
      const holeHeight = record.bottom - record.top + inset * 2;
      hole.setAttribute("x", String(left));
      hole.setAttribute("y", String(top));
      hole.setAttribute("width", String(width));
      hole.setAttribute("height", String(holeHeight));
      hole.setAttribute("rx", String(5));
      hole.setAttribute("fill", "none");
      holePaths.push(
        "M " + left + " " + top
        + " H " + (left + width)
        + " V " + (top + holeHeight)
        + " H " + left + " Z",
      );
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
    const firstByChange = new Set();
    merged.forEach((record) => {
      const box = document.createElement("div");
      box.setAttribute("data-pageroot-review-overlay-box", record.changeId);
      box.dataset.tone = record.tone;
      box.dataset.tones = record.tones.join(" ");
      box.dataset.types = record.types.join(" ");
      box.dataset.summary = record.summary;
      const active = currentState.focus !== "all" && currentState.focus === record.changeId && !firstByChange.has(record.changeId);
      box.dataset.active = active ? "true" : "false";
      firstByChange.add(record.changeId);
      box.style.setProperty("left", (record.left - inset) + "px", "important");
      box.style.setProperty("top", (record.top - inset) + "px", "important");
      box.style.setProperty("width", (record.right - record.left + inset * 2) + "px", "important");
      box.style.setProperty("height", (record.bottom - record.top + inset * 2) + "px", "important");
      layer.append(box);
    });
    document.body.append(layer);
    document.documentElement.dataset.pagerootReviewOverlays = merged.length ? "true" : "false";
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
    scheduleOverlayRender();
  };
  addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source !== "pageroot-ai-review-parent" || message.sessionId !== sessionId) return;
    if (message.type === "state") applyState(message.state || {});
    if (message.type === "sync-scroll") syncScroll(message);
    if (message.type === "activate-panel") activatePanelKey(message.panelKey);
    if (message.type === "mirror-action") mirrorAction(message);
    if (message.type === "focus-change") {
      const changeId = String(message.changeId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-review-id="' + changeId + '"]');
      focusTarget(target, message.panelKey);
    }
    if (message.type === "focus-outline") {
      const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]');
      focusTarget(target, message.panelKey);
    }
  });
  addEventListener("click", (event) => {
    post("interaction");
    const action = event.target instanceof Element
      ? event.target.closest("[data-pageroot-review-action-key]")
      : null;
    if (action && !mirroringAction && !mirroringPanel) {
      const actionKey = action.getAttribute("data-pageroot-review-action-key") || "";
      const panelKey = action.closest("[data-pageroot-review-panel-key]")
        ?.getAttribute("data-pageroot-review-panel-key") || "";
      scheduleOverlayRender();
      requestAnimationFrame(() => {
        post("action", { actionKey, panelKey });
        requestAnimationFrame(scheduleOverlayRender);
      });
    }
    const control = event.target instanceof Element
      ? event.target.closest('[role="tab"][data-pageroot-review-panel-key], button[aria-controls][data-pageroot-review-panel-key], button[data-p][data-pageroot-review-panel-key], button[data-tab][data-pageroot-review-panel-key]')
      : null;
    if (control && !mirroringPanel && !mirroringAction) {
      const panelKey = control.getAttribute("data-pageroot-review-panel-key") || "";
      requestAnimationFrame(() => {
        scheduleOverlayRender();
        post("panel-change", { panelKey });
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
      value: action.value,
      checked: action instanceof HTMLInputElement ? action.checked : undefined,
    });
  };
  addEventListener("input", postControlState, true);
  addEventListener("change", postControlState, true);
  addEventListener("submit", (event) => event.preventDefault(), true);
  addEventListener("scroll", () => {
    if (programmaticScrollToken) {
      if (Math.abs(scrollY - programmaticScrollTop) <= 1) scheduleOverlayRender();
      return;
    }
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      post("scroll", { ...reviewAnchor(), left: scrollX });
    });
  }, { passive: true });
  addEventListener("resize", scheduleOverlayRender, { passive: true });
  const mutationObserver = new MutationObserver((mutations) => {
    const onlyOverlayChanges = mutations.every((mutation) => {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => (
        node instanceof Element
        && (node.matches("[data-pageroot-review-projection-layer]")
          || Boolean(node.closest("[data-pageroot-review-projection-layer]")))
      ));
    });
    if (!onlyOverlayChanges) scheduleOverlayRender();
  });
  if (document.body) mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-hidden", "aria-selected", "class", "hidden", "open", "style"],
  });
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(scheduleOverlayRender)
    : null;
  if (resizeObserver && document.body) resizeObserver.observe(document.body);
  const announceReady = () => post("ready", {
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  });
  const ready = () => {
    announceReady();
    scheduleOverlayRender();
    document.fonts?.ready?.then(scheduleOverlayRender).catch(() => {});
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
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
  document.documentElement.dataset.pagerootReviewFilter = "all";
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
  annotatePanelPairs(beforeDocument, afterDocument);
  annotateActionPairs(beforeDocument, afterDocument);
  const pairs = pairSections(
    candidateSections(beforeDocument),
    candidateSections(afterDocument),
  );
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];

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
    const panelKey = panelKeyForElement(pair.after) || panelKeyForElement(pair.before);
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
      ...(movement ? { movement } : {}),
    });
  });

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
