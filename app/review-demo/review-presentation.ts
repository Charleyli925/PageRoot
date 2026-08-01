export type ReviewSide = "before" | "after";
export type ReviewDiffFilter = "all" | "text" | "structure" | "style";
export type ReviewDiffTargets = Record<Exclude<ReviewDiffFilter, "all">, string[]>;

type ReviewChange = {
  id: string;
  anchor: string;
};

type ElementEntry = {
  element: HTMLElement;
  identity: string;
  rawText: string;
  text: string;
  order: number;
};

type ElementPair = {
  before: ElementEntry;
  after: ElementEntry;
};

type PairResult = {
  pairs: ElementPair[];
  beforeOnly: ElementEntry[];
  afterOnly: ElementEntry[];
};

type TextToken = {
  value: string;
  start: number;
  end: number;
};

const REVIEW_MODE_CLASSES = [
  "pageroot-mode-all",
  "pageroot-mode-text",
  "pageroot-mode-structure",
  "pageroot-mode-style",
];

const STYLE_PROPERTIES = [
  ["background-color", "背景"],
  ["color", "文字颜色"],
  ["border-top-color", "边框颜色"],
  ["border-top-width", "边框粗细"],
  ["border-radius", "圆角"],
  ["box-shadow", "阴影"],
  ["font-size", "字号"],
  ["font-weight", "字重"],
  ["letter-spacing", "字距"],
] as const;

const REVIEW_FRAME_STYLE = `
  html {
    --pageroot-context-opacity: .5;
    --pageroot-context-grayscale: .28;
    --pageroot-context-saturation: .72;
    --pageroot-focus-mask-opacity: .28;
  }

  html, body { scroll-behavior: auto !important; overflow-anchor: none !important; }

  body.pageroot-section-focus [data-test-module] {
    transition: opacity 180ms ease, filter 180ms ease !important;
  }

  body.pageroot-section-focus [data-test-module]:not([data-pageroot-active='true']) {
    opacity: var(--pageroot-context-opacity) !important;
    filter: grayscale(var(--pageroot-context-grayscale)) saturate(var(--pageroot-context-saturation)) !important;
  }

  [data-pageroot-active='true'] {
    position: relative !important;
    isolation: isolate !important;
    opacity: 1 !important;
    filter: none !important;
  }

  .pageroot-focus-mask {
    position: absolute !important;
    z-index: 2147483000 !important;
    inset: 0 !important;
    display: block !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: rgb(247 248 251 / var(--pageroot-focus-mask-opacity)) !important;
    box-shadow: none !important;
    opacity: 1 !important;
    transform: none !important;
    animation: none !important;
    backdrop-filter: saturate(.82) !important;
    pointer-events: none !important;
  }

  body.pageroot-mode-text .pageroot-focus-mask {
    backdrop-filter: blur(.45px) saturate(.72) !important;
  }

  body.pageroot-mode-structure .pageroot-focus-mask {
    backdrop-filter: saturate(.82) !important;
  }

  body.pageroot-mode-style .pageroot-focus-mask {
    backdrop-filter: grayscale(.12) saturate(.72) !important;
  }

  [data-pageroot-token='true'] {
    position: relative !important;
    z-index: 2147483020 !important;
    display: inline !important;
    margin-inline: .025em !important;
    padding: .025em .08em .045em !important;
    border-radius: .28em !important;
    background: transparent !important;
    color: inherit !important;
    opacity: 1 !important;
    filter: none !important;
    box-decoration-break: clone !important;
    -webkit-box-decoration-break: clone !important;
  }

  .pageroot-token-removed {
    background: transparent !important;
    color: inherit !important;
    text-decoration-line: line-through !important;
    text-decoration-color: #c04e48 !important;
    text-decoration-thickness: 1.5px !important;
    box-shadow: inset 0 0 0 1px rgba(196, 72, 66, .72) !important;
  }

  .pageroot-token-added {
    background: transparent !important;
    color: inherit !important;
    text-decoration-line: underline !important;
    text-decoration-color: #249269 !important;
    text-decoration-thickness: 1.5px !important;
    text-underline-offset: .16em !important;
    box-shadow: inset 0 0 0 1px rgba(31, 143, 99, .72) !important;
  }

  .pageroot-diff-text {
    position: relative !important;
  }

  .pageroot-structure-from,
  .pageroot-structure-to,
  .pageroot-structure-removed,
  .pageroot-structure-added,
  .pageroot-style-reference,
  .pageroot-style-change {
    position: relative !important;
    z-index: 2147483010 !important;
  }

  .pageroot-structure-from {
    outline: 1.5px dashed rgba(111, 106, 125, .78) !important;
    outline-offset: 2px !important;
    box-shadow: inset 3px 0 0 rgba(111, 106, 125, .82) !important;
  }

  .pageroot-structure-to {
    outline: 2px solid rgba(98, 87, 210, .86) !important;
    outline-offset: 2px !important;
    box-shadow: inset 0 -3px 0 rgba(98, 87, 210, .88) !important;
  }

  .pageroot-structure-removed {
    outline: 1.5px solid rgba(207, 90, 83, .82) !important;
    outline-offset: 2px !important;
    box-shadow: inset 3px 0 0 #cf5a53 !important;
  }

  .pageroot-structure-added {
    outline: 1.5px solid rgba(38, 151, 107, .84) !important;
    outline-offset: 2px !important;
    box-shadow: inset 0 -3px 0 #26976b !important;
  }

  .pageroot-style-reference {
    outline: 1.5px dashed rgba(80, 103, 121, .7) !important;
    outline-offset: 2px !important;
    box-shadow: none !important;
  }

  .pageroot-style-change {
    outline: 2px solid rgba(25, 127, 167, .84) !important;
    outline-offset: 2px !important;
    box-shadow: none !important;
  }

  .pageroot-review-label {
    position: absolute !important;
    z-index: 2147483030 !important;
    display: inline-flex !important;
    align-items: center !important;
    width: max-content !important;
    max-width: min(320px, calc(100% - 12px)) !important;
    min-height: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    color: #5b55bd !important;
    font: 760 10.5px/1.25 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    letter-spacing: .01em !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    box-shadow: none !important;
    text-shadow: 0 1px 2px rgba(255, 255, 255, .98), 0 0 5px rgba(255, 255, 255, .96) !important;
    opacity: 0 !important;
    visibility: hidden !important;
    transform: translateY(-2px) !important;
    transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease !important;
    pointer-events: none !important;
  }

  .pageroot-label-text {
    top: 4px !important;
    left: 5px !important;
  }

  .pageroot-label-removed { color: #b0443f !important; }
  .pageroot-label-added { color: #197b56 !important; }

  .pageroot-label-structure {
    top: 4px !important;
    left: 5px !important;
    color: #5d56bf !important;
  }

  .pageroot-label-structure-before { color: #6f6a7d !important; }
  .pageroot-label-structure-after { color: #5d56bf !important; }

  .pageroot-label-style {
    top: 4px !important;
    right: auto !important;
    left: 5px !important;
    color: #176f93 !important;
  }

  .pageroot-label-style-before { color: #536b7b !important; }
  .pageroot-label-style-after { color: #176f93 !important; }

  .pageroot-label-mixed { color: #514ba9 !important; }

  [data-pageroot-diff]:hover > .pageroot-review-label,
  [data-pageroot-diff]:focus-within > .pageroot-review-label {
    opacity: 1 !important;
    visibility: visible !important;
    transform: translateY(0) !important;
  }

  [data-pageroot-diff]:has([data-pageroot-diff]:hover) > .pageroot-review-label,
  [data-pageroot-diff]:has([data-pageroot-diff]:focus-within) > .pageroot-review-label {
    opacity: 0 !important;
    visibility: hidden !important;
  }

  @media (prefers-reduced-motion: reduce) {
    body.pageroot-section-focus [data-test-module] { transition: none !important; }
  }
`;

function rawElementText(element: Element) {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-pageroot-overlay='true']")) return NodeFilter.FILTER_REJECT;
      if (parent.matches("script, style, noscript")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    parts.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return parts.join("");
}

function cleanText(element: Element) {
  return rawElementText(element).replace(/\s+/g, " ").trim();
}

function elementIdentity(element: HTMLElement) {
  const direct = [
    element.id,
    element.dataset.card,
    element.getAttribute("name"),
    element.getAttribute("aria-label"),
    element.getAttribute("href"),
  ].find(Boolean);
  if (direct) return `${element.tagName}:${direct}`;

  const identityChild = element.matches("tr")
    ? element.querySelector("th")
    : element.querySelector("h1, h2, h3, h4, legend, figcaption strong, [data-review-key]");
  if (identityChild) return `${element.tagName}:${cleanText(identityChild)}`;

  const classKey = [...element.classList]
    .filter((className) => !className.startsWith("pageroot-"))
    .sort()
    .join(".");
  return `${element.tagName}:${classKey}`;
}

function collectEntries(section: HTMLElement, selectors: string[]) {
  const seen = new Set<HTMLElement>();
  const elements: HTMLElement[] = [];
  selectors.forEach((selector) => {
    section.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (seen.has(element) || !cleanText(element)) return;
      seen.add(element);
      elements.push(element);
    });
  });
  elements.sort((left, right) => {
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return elements.map((element, order) => {
    const rawText = rawElementText(element);
    return {
      element,
      identity: elementIdentity(element),
      rawText,
      text: rawText.replace(/\s+/g, " ").trim(),
      order,
    };
  });
}

function tokenize(text: string) {
  const tokens: TextToken[] = [];
  const matcher = /[\p{Script=Han}]|[\p{L}\p{N}]+(?:[.,:%+\-][\p{L}\p{N}]+)*|[^\s]/gu;
  let match = matcher.exec(text);
  while (match) {
    tokens.push({ value: match[0].toLocaleLowerCase("zh-CN"), start: match.index, end: match.index + match[0].length });
    match = matcher.exec(text);
  }
  return tokens;
}

function lcsMatches(beforeTokens: TextToken[], afterTokens: TextToken[]) {
  const rows = beforeTokens.length + 1;
  const columns = afterTokens.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] = beforeTokens[beforeIndex].value === afterTokens[afterIndex].value
        ? table[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  const beforeMatched = new Set<number>();
  const afterMatched = new Set<number>();
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeTokens.length && afterIndex < afterTokens.length) {
    if (beforeTokens[beforeIndex].value === afterTokens[afterIndex].value) {
      beforeMatched.add(beforeIndex);
      afterMatched.add(afterIndex);
      beforeIndex += 1;
      afterIndex += 1;
    } else if (table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1]) {
      beforeIndex += 1;
    } else {
      afterIndex += 1;
    }
  }
  return { beforeMatched, afterMatched, length: table[0][0] };
}

function textSimilarity(beforeText: string, afterText: string) {
  const beforeTokens = tokenize(beforeText);
  const afterTokens = tokenize(afterText);
  if (!beforeTokens.length || !afterTokens.length) return 0;
  return lcsMatches(beforeTokens, afterTokens).length / Math.max(beforeTokens.length, afterTokens.length);
}

function pairEntries(beforeEntries: ElementEntry[], afterEntries: ElementEntry[], identityFirst: boolean): PairResult {
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const pairs: ElementPair[] = [];

  const matchExact = (mode: "identity" | "text") => {
    beforeEntries.forEach((before, beforeIndex) => {
      if (usedBefore.has(beforeIndex)) return;
      const afterIndex = afterEntries.findIndex((after, candidateIndex) => (
        !usedAfter.has(candidateIndex)
        && (mode === "identity" ? before.identity === after.identity : before.text === after.text)
      ));
      if (afterIndex < 0) return;
      usedBefore.add(beforeIndex);
      usedAfter.add(afterIndex);
      pairs.push({ before, after: afterEntries[afterIndex] });
    });
  };

  if (identityFirst) {
    matchExact("identity");
    matchExact("text");
  } else {
    matchExact("text");
    matchExact("identity");
  }

  beforeEntries.forEach((before, beforeIndex) => {
    if (usedBefore.has(beforeIndex)) return;
    let bestAfterIndex = -1;
    let bestScore = 0;
    afterEntries.forEach((after, afterIndex) => {
      if (usedAfter.has(afterIndex) || before.element.tagName !== after.element.tagName) return;
      const score = textSimilarity(before.text, after.text);
      if (score > bestScore) {
        bestScore = score;
        bestAfterIndex = afterIndex;
      }
    });
    if (bestAfterIndex < 0 || bestScore < .28) return;
    usedBefore.add(beforeIndex);
    usedAfter.add(bestAfterIndex);
    pairs.push({ before, after: afterEntries[bestAfterIndex] });
  });

  return {
    pairs,
    beforeOnly: beforeEntries.filter((_, index) => !usedBefore.has(index)),
    afterOnly: afterEntries.filter((_, index) => !usedAfter.has(index)),
  };
}

function rangesForUnmatched(tokens: TextToken[], matched: Set<number>) {
  const ranges = tokens
    .filter((_, index) => !matched.has(index))
    .map((token) => ({ start: token.start, end: token.end }));
  return ranges.reduce<Array<{ start: number; end: number }>>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
    return merged;
  }, []);
}

function wrapTextRanges(element: HTMLElement, ranges: Array<{ start: number; end: number }>, side: ReviewSide) {
  if (!ranges.length) return false;
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-pageroot-overlay='true'], [data-pageroot-token='true']")) return NodeFilter.FILTER_REJECT;
      if (parent.matches("script, style, noscript")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent ?? "";
    nodes.push({ node: current as Text, start: offset, end: offset + text.length });
    offset += text.length;
    current = walker.nextNode();
  }

  nodes.forEach(({ node, start, end }) => {
    const intersections = ranges
      .map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
      .filter((range) => range.end > range.start);
    if (!intersections.length) return;
    const source = node.textContent ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    intersections.forEach((range) => {
      const localStart = range.start - start;
      const localEnd = range.end - start;
      if (localStart > cursor) fragment.append(source.slice(cursor, localStart));
      const span = document.createElement("span");
      span.dataset.pagerootToken = "true";
      span.className = side === "before" ? "pageroot-token-removed" : "pageroot-token-added";
      span.textContent = source.slice(localStart, localEnd);
      fragment.append(span);
      cursor = localEnd;
    });
    if (cursor < source.length) fragment.append(source.slice(cursor));
    node.replaceWith(fragment);
  });
  return true;
}

function appendLabel(element: HTMLElement, tone: "removed" | "added" | "structure" | "style", text: string) {
  let label = element.querySelector<HTMLElement>(":scope > .pageroot-review-label");
  if (!label) {
    label = element.ownerDocument.createElement("span");
    label.dataset.pagerootOverlay = "true";
    label.setAttribute("aria-hidden", "true");
    label.className = "pageroot-review-label";
    element.append(label);
  }
  const parts = (label.dataset.pagerootLabelParts ?? "").split("\n").filter(Boolean);
  if (!parts.includes(text)) parts.push(text);
  label.dataset.pagerootLabelParts = parts.join("\n");
  label.classList.add(
    `pageroot-label-${tone === "removed" || tone === "added" ? "text" : tone}`,
    `pageroot-label-${tone}`,
  );
  label.classList.toggle("pageroot-label-mixed", parts.length > 1);
  label.textContent = parts.join(" · ");
  return label;
}

function appendFocusMask(section: HTMLElement) {
  const mask = section.ownerDocument.createElement("span");
  mask.dataset.pagerootOverlay = "true";
  mask.setAttribute("aria-hidden", "true");
  mask.className = "pageroot-focus-mask";
  section.append(mask);
}

function markText(entry: ElementEntry, side: ReviewSide, ranges: Array<{ start: number; end: number }>) {
  if (!wrapTextRanges(entry.element, ranges, side)) return;
  entry.element.dataset.pagerootDiff = "text";
  entry.element.classList.add("pageroot-diff-text");
  appendLabel(entry.element, side === "before" ? "removed" : "added", side === "before" ? "删除" : "新增");
}

function applyTextDiff(beforeSection: HTMLElement, afterSection: HTMLElement, selectors: string[]) {
  const result = pairEntries(collectEntries(beforeSection, selectors), collectEntries(afterSection, selectors), false);
  result.pairs.forEach((pair) => {
    if (pair.before.text === pair.after.text) return;
    const beforeTokens = tokenize(pair.before.rawText);
    const afterTokens = tokenize(pair.after.rawText);
    const matches = lcsMatches(beforeTokens, afterTokens);
    markText(pair.before, "before", rangesForUnmatched(beforeTokens, matches.beforeMatched));
    markText(pair.after, "after", rangesForUnmatched(afterTokens, matches.afterMatched));
  });
  result.beforeOnly.forEach((entry) => markText(entry, "before", rangesForUnmatched(tokenize(entry.rawText), new Set())));
  result.afterOnly.forEach((entry) => markText(entry, "after", rangesForUnmatched(tokenize(entry.rawText), new Set())));
}

function relativeRect(element: HTMLElement, section: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  return {
    left: rect.left - sectionRect.left,
    top: rect.top - sectionRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function geometryChanged(before: ElementEntry, after: ElementEntry, beforeSection: HTMLElement, afterSection: HTMLElement) {
  const beforeRect = relativeRect(before.element, beforeSection);
  const afterRect = relativeRect(after.element, afterSection);
  return before.order !== after.order
    || Math.abs(beforeRect.left - afterRect.left) > 8
    || Math.abs(beforeRect.top - afterRect.top) > 8
    || Math.abs(beforeRect.width - afterRect.width) > 8
    || Math.abs(beforeRect.height - afterRect.height) > 8;
}

function markStructure(entry: ElementEntry, side: ReviewSide, label: string, addedOrRemoved = false) {
  entry.element.dataset.pagerootDiff = "structure";
  entry.element.classList.add(addedOrRemoved
    ? side === "before" ? "pageroot-structure-removed" : "pageroot-structure-added"
    : side === "before" ? "pageroot-structure-from" : "pageroot-structure-to");
  appendLabel(entry.element, "structure", label).classList.add(`pageroot-label-structure-${side}`);
}

function applyStructureDiff(beforeSection: HTMLElement, afterSection: HTMLElement, selectors: string[]) {
  const result = pairEntries(collectEntries(beforeSection, selectors), collectEntries(afterSection, selectors), true);
  result.pairs.forEach((pair) => {
    if (!geometryChanged(pair.before, pair.after, beforeSection, afterSection)) return;
    const moved = pair.before.order !== pair.after.order;
    markStructure(pair.before, "before", moved ? `原第 ${pair.before.order + 1} 位` : "原布局");
    markStructure(pair.after, "after", moved ? `移到第 ${pair.after.order + 1} 位` : "新布局");
  });
  result.beforeOnly.forEach((entry) => markStructure(entry, "before", "结构删除", true));
  result.afterOnly.forEach((entry) => markStructure(entry, "after", "结构新增", true));
}

function changedStyleLabels(before: HTMLElement, after: HTMLElement) {
  const beforeStyle = before.ownerDocument.defaultView?.getComputedStyle(before);
  const afterStyle = after.ownerDocument.defaultView?.getComputedStyle(after);
  if (!beforeStyle || !afterStyle) return [];
  return STYLE_PROPERTIES
    .filter(([property]) => beforeStyle.getPropertyValue(property).trim() !== afterStyle.getPropertyValue(property).trim())
    .map(([, label]) => label);
}

function markStyle(element: HTMLElement, side: ReviewSide, label: string) {
  element.dataset.pagerootDiff = "style";
  element.classList.add(side === "before" ? "pageroot-style-reference" : "pageroot-style-change");
  appendLabel(element, "style", label).classList.add(`pageroot-label-style-${side}`);
}

function applyStyleDiff(beforeSection: HTMLElement, afterSection: HTMLElement, selectors: string[]) {
  const result = pairEntries(collectEntries(beforeSection, selectors), collectEntries(afterSection, selectors), true);
  result.pairs.forEach((pair) => {
    const labels = changedStyleLabels(pair.before.element, pair.after.element);
    if (!labels.length) return;
    markStyle(pair.before.element, "before", "原样式");
    markStyle(pair.after.element, "after", `新样式 · ${labels.slice(0, 3).join("、")}`);
  });
  result.afterOnly.forEach((entry) => markStyle(entry.element, "after", "新增视觉样式"));
}

function ensurePresentationStyle(document: Document) {
  let style = document.getElementById("pageroot-review-presentation") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "pageroot-review-presentation";
    document.head.append(style);
  }
  style.textContent = REVIEW_FRAME_STYLE;
}

function setDocumentMaskTransparency(document: Document | null | undefined, value: number) {
  if (!document?.documentElement) return;
  const transparency = Math.max(40, Math.min(95, value)) / 100;
  const maskOpacity = 1 - transparency;
  const contextOpacity = .18 + transparency * .45;
  document.documentElement.style.setProperty("--pageroot-focus-mask-opacity", maskOpacity.toFixed(2));
  document.documentElement.style.setProperty("--pageroot-context-opacity", contextOpacity.toFixed(2));
  document.documentElement.style.setProperty("--pageroot-context-grayscale", (maskOpacity * .55).toFixed(2));
  document.documentElement.style.setProperty("--pageroot-context-saturation", (.72 + transparency * .22).toFixed(2));
}

export function setReviewPresentationMaskTransparency(
  beforeFrame: HTMLIFrameElement | null,
  afterFrame: HTMLIFrameElement | null,
  value: number,
) {
  setDocumentMaskTransparency(beforeFrame?.contentDocument, value);
  setDocumentMaskTransparency(afterFrame?.contentDocument, value);
}

function removeInjectedPresentation(document: Document) {
  document.querySelectorAll<HTMLElement>("[data-pageroot-overlay='true']").forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>("[data-pageroot-token='true']").forEach((element) => {
    const parent = element.parentNode;
    element.replaceWith(...element.childNodes);
    parent?.normalize();
  });
  document.body?.classList.remove("pageroot-section-focus", "pageroot-diff-focus", ...REVIEW_MODE_CLASSES);
  document.querySelectorAll<HTMLElement>("[data-pageroot-active]").forEach((element) => element.removeAttribute("data-pageroot-active"));
  document.querySelectorAll<HTMLElement>("[data-pageroot-diff]").forEach((element) => {
    element.removeAttribute("data-pageroot-diff");
    element.classList.remove(
      "pageroot-diff-text",
      "pageroot-structure-from",
      "pageroot-structure-to",
      "pageroot-structure-removed",
      "pageroot-structure-added",
      "pageroot-style-reference",
      "pageroot-style-change",
    );
  });
}

export function applyReviewPresentationPair(
  beforeFrame: HTMLIFrameElement | null,
  afterFrame: HTMLIFrameElement | null,
  change: ReviewChange,
  filter: ReviewDiffFilter,
  focused: boolean,
  targetsByChange: Record<string, ReviewDiffTargets>,
) {
  const beforeDocument = beforeFrame?.contentDocument;
  const afterDocument = afterFrame?.contentDocument;
  if (!beforeDocument?.body || !afterDocument?.body) return;

  ensurePresentationStyle(beforeDocument);
  ensurePresentationStyle(afterDocument);
  removeInjectedPresentation(beforeDocument);
  removeInjectedPresentation(afterDocument);
  beforeDocument.documentElement.dataset.pagerootSide = "before";
  afterDocument.documentElement.dataset.pagerootSide = "after";
  if (!focused) return;

  const beforeSection = beforeDocument.getElementById(change.anchor);
  const afterSection = afterDocument.getElementById(change.anchor);
  const targets = targetsByChange[change.id];
  if (!beforeSection || !afterSection || !targets) return;

  [beforeDocument, afterDocument].forEach((document) => {
    document.body.classList.add("pageroot-section-focus", "pageroot-diff-focus", `pageroot-mode-${filter}`);
  });
  beforeSection.dataset.pagerootActive = "true";
  afterSection.dataset.pagerootActive = "true";
  appendFocusMask(beforeSection);
  appendFocusMask(afterSection);

  const activeFilters: Exclude<ReviewDiffFilter, "all">[] = filter === "all"
    ? ["style", "structure", "text"]
    : [filter];

  activeFilters.forEach((activeFilter) => {
    if (activeFilter === "style") applyStyleDiff(beforeSection, afterSection, targets.style);
    if (activeFilter === "structure") applyStructureDiff(beforeSection, afterSection, targets.structure);
    if (activeFilter === "text") applyTextDiff(beforeSection, afterSection, targets.text);
  });
}

export function clearReviewPresentation(frame: HTMLIFrameElement | null) {
  if (frame?.contentDocument) removeInjectedPresentation(frame.contentDocument);
}
