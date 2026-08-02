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

export type ReviewDocuments = {
  before: string;
  after: string;
  changes: ReviewChange[];
};

const REVIEW_STYLE_ID = "pageroot-ai-review-style";
const REVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-ai-review-bootstrap";
const REVIEW_BASE_ATTRIBUTE = "data-pageroot-ai-review-base";

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

  [data-pageroot-review-id] {
    transition: opacity 160ms ease, filter 160ms ease, outline-color 120ms ease !important;
  }

  html[data-pageroot-review-focus]:not([data-pageroot-review-focus="all"])
    [data-pageroot-review-id][data-pageroot-review-active="false"] {
    opacity: var(--pageroot-review-context-opacity) !important;
    filter: grayscale(var(--pageroot-review-context-grayscale))
      saturate(var(--pageroot-review-context-saturation)) !important;
  }

  html[data-pageroot-review-focus]:not([data-pageroot-review-focus="all"])
    [data-pageroot-review-id][data-pageroot-review-active="true"] {
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
    [data-pageroot-review-id] { transition: none !important; }
  }
`;

function normalizedText(element: Element | null): string {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
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
  return [
    element.getAttribute("class") || "",
    element.getAttribute("style") || "",
    element.getAttribute("hidden") || "",
    element.getAttribute("width") || "",
    element.getAttribute("height") || "",
    element.getAttribute("data-state") || "",
  ].join("|");
}

function directHeading(element: Element): Element | null {
  return element.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > header h1, :scope > header h2, :scope > header h3")
    || element.querySelector("h1, h2, h3");
}

function changeLabel(
  before: Element | null,
  after: Element | null,
  index: number,
): string {
  const preferred = after || before;
  const heading = directHeading(preferred as Element);
  const label = normalizedText(heading)
    || preferred?.getAttribute("aria-label")
    || preferred?.id
    || `页面区域 ${index + 1}`;
  return label.length > 52 ? `${label.slice(0, 52)}…` : label;
}

function candidateSections(document: Document): Element[] {
  const selectors = [
    "[data-test-module]",
    "main > section",
    "body > section",
    "body > main > section",
    "section[id]",
    "article[id]",
  ];
  const seen = new Set<Element>();
  const candidates: Element[] = [];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (seen.has(element)) return;
      seen.add(element);
      candidates.push(element);
    });
  });

  const roots = candidates.filter((candidate) => (
    !candidates.some((possibleParent) => (
      possibleParent !== candidate && possibleParent.contains(candidate)
    ))
  ));
  if (roots.length) return roots;

  const bodyChildren = [...(document.body?.children || [])].filter((element) => (
    !["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE"].includes(element.tagName)
  ));
  return bodyChildren.length ? bodyChildren : document.body ? [document.body] : [];
}

function pairKey(element: Element): string | null {
  if (element.id) return `id:${element.id}`;
  const testModule = element.getAttribute("data-test-module");
  if (testModule) return `module:${testModule}`;
  return null;
}

type SectionPair = { before: Element | null; after: Element | null };

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
    if (!afterElement) {
      const positional = after[index];
      if (positional && !usedAfter.has(positional) && positional.tagName === beforeElement.tagName) {
        afterElement = positional;
      }
    }
    if (afterElement) usedAfter.add(afterElement);
    pairs.push({ before: beforeElement, after: afterElement });
  });
  after.forEach((afterElement) => {
    if (!usedAfter.has(afterElement)) pairs.push({ before: null, after: afterElement });
  });
  return pairs;
}

function changeTypes(before: Element | null, after: Element | null): ReviewChangeType[] {
  if (!before || !after) return ["text", "structure"];
  const types: ReviewChangeType[] = [];
  if (normalizedText(before) !== normalizedText(after)) types.push("text");
  if (structureSignature(before) !== structureSignature(after)) types.push("structure");
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
    document.querySelectorAll("[data-pageroot-review-id]").forEach((element) => {
      element.dataset.pagerootReviewActive = state.focus === "all" || element.dataset.pagerootReviewId === state.focus
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
): string {
  document.querySelectorAll('script, meta[http-equiv="refresh" i]').forEach((element) => {
    element.remove();
  });
  document.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    });
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
  bootstrap.textContent = reviewBootstrap(sessionId, side);

  const baseHref = baseHrefFromSourcePath(sourcePath);
  if (baseHref && !document.head.querySelector("base")) {
    const base = document.createElement("base");
    base.href = baseHref;
    base.setAttribute(REVIEW_BASE_ATTRIBUTE, "true");
    document.head.insertBefore(base, document.head.firstChild);
  }
  document.head.append(style, bootstrap);
  return `${doctypeString(document.doctype)}\n${document.documentElement.outerHTML}`;
}

export function buildReviewDocuments(
  beforeHtml: string,
  afterHtml: string,
  options: { sessionId: string; sourcePath?: string },
): ReviewDocuments {
  if (typeof DOMParser === "undefined") {
    return { before: beforeHtml, after: afterHtml, changes: [] };
  }
  const parser = new DOMParser();
  const beforeDocument = parser.parseFromString(beforeHtml, "text/html");
  const afterDocument = parser.parseFromString(afterHtml, "text/html");
  const pairs = pairSections(
    candidateSections(beforeDocument),
    candidateSections(afterDocument),
  );
  const changes: ReviewChange[] = [];

  pairs.forEach((pair, pairIndex) => {
    if (
      pair.before
      && pair.after
      && normalizedMarkup(pair.before) === normalizedMarkup(pair.after)
    ) return;
    const types = changeTypes(pair.before, pair.after);
    if (!types.length) return;
    const id = `change-${changes.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const helper = helperText(types, Boolean(pair.before), Boolean(pair.after));
    [pair.before, pair.after].forEach((element) => {
      if (!element) return;
      element.setAttribute("data-pageroot-review-id", id);
      element.setAttribute("data-pageroot-review-active", "false");
      element.setAttribute("data-pageroot-review-types", types.join(" "));
      element.setAttribute("data-pageroot-review-summary", helper);
    });
    changes.push({
      id,
      label,
      helper,
      types,
      beforePresent: Boolean(pair.before),
      afterPresent: Boolean(pair.after),
    });
  });

  if (!changes.length && beforeHtml !== afterHtml) {
    const beforeBody = beforeDocument.body;
    const afterBody = afterDocument.body;
    [beforeBody, afterBody].forEach((element) => {
      element.setAttribute("data-pageroot-review-id", "change-1");
      element.setAttribute("data-pageroot-review-active", "false");
      element.setAttribute("data-pageroot-review-types", "text structure style");
      element.setAttribute("data-pageroot-review-summary", "整页内容发生变化");
    });
    changes.push({
      id: "change-1",
      label: "完整页面",
      helper: "整页内容发生变化",
      types: ["text", "structure", "style"],
      beforePresent: true,
      afterPresent: true,
    });
  }

  return {
    before: prepareDocument(beforeDocument, "before", options.sessionId, options.sourcePath),
    after: prepareDocument(afterDocument, "after", options.sessionId, options.sourcePath),
    changes,
  };
}
