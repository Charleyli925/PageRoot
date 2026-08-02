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

type TextRange = {
  start: number;
  end: number;
};

type ClauseRange = TextRange & {
  value: string;
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
    --pageroot-context-opacity: .39;
    --pageroot-context-grayscale: .43;
    --pageroot-context-saturation: .77;
    --pageroot-focus-mask-opacity: .78;
    --pageroot-review-ui-scale: 1;
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
    backdrop-filter: saturate(.76) !important;
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
    margin: 0 !important;
    padding: 0 !important;
    border-radius: 0 !important;
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
    text-decoration-style: dashed !important;
    text-decoration-color: #c04e48 !important;
    text-decoration-thickness: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-token-added {
    background: transparent !important;
    color: inherit !important;
    text-decoration: none !important;
    box-shadow: none !important;
  }

  [data-pageroot-clause='true'] {
    position: relative !important;
    z-index: 2147483018 !important;
    display: inline !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: calc(3px * var(--pageroot-review-ui-scale)) !important;
    background: transparent !important;
    color: inherit !important;
    opacity: 1 !important;
    filter: none !important;
    box-decoration-break: clone !important;
    -webkit-box-decoration-break: clone !important;
  }

  .pageroot-clause-removed {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(207, 82, 76, .86) !important;
    outline-offset: 0 !important;
    box-shadow: none !important;
  }

  .pageroot-clause-added {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(35, 148, 103, .9) !important;
    outline-offset: 0 !important;
    box-shadow: none !important;
  }

  .pageroot-diff-text {
    position: relative !important;
    overflow: visible !important;
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
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(111, 106, 125, .82) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-structure-to {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(98, 87, 210, .9) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-structure-removed {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(207, 90, 83, .88) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-structure-added {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(38, 151, 107, .9) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-style-reference {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(80, 103, 121, .76) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-style-change {
    outline: calc(2px * var(--pageroot-review-ui-scale)) dashed rgba(25, 127, 167, .9) !important;
    outline-offset: calc(2px * var(--pageroot-review-ui-scale)) !important;
    box-shadow: none !important;
  }

  .pageroot-review-label {
    position: absolute !important;
    z-index: 2147483030 !important;
    display: inline-flex !important;
    align-items: center !important;
    width: max-content !important;
    max-width: min(calc(320px * var(--pageroot-review-ui-scale)), calc(100vw - 24px * var(--pageroot-review-ui-scale))) !important;
    min-height: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    color: #5b55bd !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: calc(11.5px * var(--pageroot-review-ui-scale)) !important;
    font-weight: 780 !important;
    line-height: 1.2 !important;
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
    color: #514ba9 !important;
  }

  .pageroot-label-removed { color: #b0443f !important; }
  .pageroot-label-added { color: #197b56 !important; }

  .pageroot-label-structure {
    color: #5d56bf !important;
  }

  .pageroot-label-structure-before { color: #6f6a7d !important; }
  .pageroot-label-structure-after { color: #5d56bf !important; }

  .pageroot-label-style {
    color: #176f93 !important;
  }

  .pageroot-label-style-before { color: #536b7b !important; }
  .pageroot-label-style-after { color: #176f93 !important; }

  .pageroot-label-mixed { color: #514ba9 !important; }

  .pageroot-review-label[data-pageroot-placement='top'] {
    top: auto !important;
    bottom: calc(100% + 5px * var(--pageroot-review-ui-scale)) !important;
  }

  .pageroot-review-label[data-pageroot-placement='bottom'] {
    top: calc(100% + 5px * var(--pageroot-review-ui-scale)) !important;
    bottom: auto !important;
  }

  .pageroot-review-label[data-pageroot-align='start'] {
    right: auto !important;
    left: 0 !important;
  }

  .pageroot-review-label[data-pageroot-align='end'] {
    right: 0 !important;
    left: auto !important;
  }

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

function trimRange(text: string, start: number, end: number): TextRange | null {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(text[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
  return trimmedEnd > trimmedStart ? { start: trimmedStart, end: trimmedEnd } : null;
}

function isCompactClauseElement(element: HTMLElement) {
  return /^(H[1-6]|BUTTON|A|LABEL|LEGEND|TH|TD|DATA)$/u.test(element.tagName);
}

function clauseRanges(entry: ElementEntry): ClauseRange[] {
  const text = entry.rawText;
  if (!text.trim()) return [];
  if (isCompactClauseElement(entry.element)) {
    const range = trimRange(text, 0, text.length);
    return range ? [{ ...range, value: text.slice(range.start, range.end) }] : [];
  }

  const ranges: ClauseRange[] = [];
  let start = 0;
  let visibleLength = 0;
  const pushRange = (end: number) => {
    const range = trimRange(text, start, end);
    if (range) ranges.push({ ...range, value: text.slice(range.start, range.end) });
    start = end;
    visibleLength = 0;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!/\s/u.test(character)) visibleLength += 1;
    const strongBoundary = /[\n\r。！？；!?;]/u.test(character);
    const secondaryBoundary = /[，,:\uff1a]/u.test(character)
      && visibleLength >= 8
      && !(/\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? ""));
    if (strongBoundary || secondaryBoundary) pushRange(index + 1);
  }
  pushRange(text.length);
  return ranges;
}

function normalizeClause(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("zh-CN");
}

function mergeRanges(ranges: TextRange[]) {
  return [...ranges]
    .sort((left, right) => left.start - right.start)
    .reduce<TextRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
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

function rangesForUnmatched(tokens: TextToken[], matched: Set<number>, offset = 0) {
  const ranges = tokens
    .filter((_, index) => !matched.has(index))
    .map((token) => ({ start: token.start + offset, end: token.end + offset }));
  return ranges.reduce<TextRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
    return merged;
  }, []);
}

function pairClauses(before: ClauseRange[], after: ClauseRange[]) {
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const pairs: Array<{ before: ClauseRange; after: ClauseRange }> = [];

  before.forEach((beforeClause, beforeIndex) => {
    const value = normalizeClause(beforeClause.value);
    const afterIndex = after.findIndex((afterClause, candidateIndex) => (
      !usedAfter.has(candidateIndex) && normalizeClause(afterClause.value) === value
    ));
    if (afterIndex < 0) return;
    usedBefore.add(beforeIndex);
    usedAfter.add(afterIndex);
    pairs.push({ before: beforeClause, after: after[afterIndex] });
  });

  before.forEach((beforeClause, beforeIndex) => {
    if (usedBefore.has(beforeIndex)) return;
    let bestAfterIndex = -1;
    let bestScore = 0;
    after.forEach((afterClause, afterIndex) => {
      if (usedAfter.has(afterIndex)) return;
      const score = textSimilarity(beforeClause.value, afterClause.value);
      if (score > bestScore) {
        bestScore = score;
        bestAfterIndex = afterIndex;
      }
    });
    if (bestAfterIndex < 0 || bestScore < .3) return;
    usedBefore.add(beforeIndex);
    usedAfter.add(bestAfterIndex);
    pairs.push({ before: beforeClause, after: after[bestAfterIndex] });
  });

  return {
    pairs,
    beforeOnly: before.filter((_, index) => !usedBefore.has(index)),
    afterOnly: after.filter((_, index) => !usedAfter.has(index)),
  };
}

function changedTextRanges(beforeEntry: ElementEntry, afterEntry: ElementEntry) {
  const result = pairClauses(clauseRanges(beforeEntry), clauseRanges(afterEntry));
  const beforeClauses: TextRange[] = [];
  const afterClauses: TextRange[] = [];
  const beforeCharacters: TextRange[] = [];
  const afterCharacters: TextRange[] = [];

  result.pairs.forEach((pair) => {
    if (normalizeClause(pair.before.value) === normalizeClause(pair.after.value)) return;
    const beforeTokens = tokenize(pair.before.value);
    const afterTokens = tokenize(pair.after.value);
    const matches = lcsMatches(beforeTokens, afterTokens);
    beforeClauses.push(pair.before);
    afterClauses.push(pair.after);
    beforeCharacters.push(...rangesForUnmatched(beforeTokens, matches.beforeMatched, pair.before.start));
    afterCharacters.push(...rangesForUnmatched(afterTokens, matches.afterMatched, pair.after.start));
  });

  result.beforeOnly.forEach((clause) => {
    beforeClauses.push(clause);
    beforeCharacters.push(...rangesForUnmatched(tokenize(clause.value), new Set(), clause.start));
  });
  result.afterOnly.forEach((clause) => {
    afterClauses.push(clause);
    afterCharacters.push(...rangesForUnmatched(tokenize(clause.value), new Set(), clause.start));
  });

  return {
    beforeClauses: mergeRanges(beforeClauses),
    afterClauses: mergeRanges(afterClauses),
    beforeCharacters: mergeRanges(beforeCharacters),
    afterCharacters: mergeRanges(afterCharacters),
  };
}

function wrapTextRanges(element: HTMLElement, ranges: TextRange[], side: ReviewSide) {
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

function wrapClauseRanges(element: HTMLElement, ranges: TextRange[], side: ReviewSide) {
  if (!ranges.length) return false;
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-pageroot-overlay='true'], [data-pageroot-clause='true'], [data-pageroot-token='true']")) {
        return NodeFilter.FILTER_REJECT;
      }
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
      span.dataset.pagerootClause = "true";
      span.className = side === "before" ? "pageroot-clause-removed" : "pageroot-clause-added";
      span.textContent = source.slice(localStart, localEnd);
      fragment.append(span);
      cursor = localEnd;
    });
    if (cursor < source.length) fragment.append(source.slice(cursor));
    node.replaceWith(fragment);
  });
  return true;
}

function placeLabel(label: HTMLElement, element: HTMLElement) {
  const document = element.ownerDocument;
  const frameWindow = document.defaultView;
  const uiScale = Number.parseFloat(document.documentElement.style.getPropertyValue("--pageroot-review-ui-scale")) || 1;
  const bounds = element.getBoundingClientRect();
  label.dataset.pagerootPlacement = bounds.top > 34 * uiScale ? "top" : "bottom";
  label.dataset.pagerootAlign = frameWindow && frameWindow.innerWidth - bounds.right < 180 * uiScale ? "end" : "start";
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
  placeLabel(label, element);
  return label;
}

function appendFocusMask(section: HTMLElement) {
  const mask = section.ownerDocument.createElement("span");
  mask.dataset.pagerootOverlay = "true";
  mask.setAttribute("aria-hidden", "true");
  mask.className = "pageroot-focus-mask";
  section.append(mask);
}

function markText(entry: ElementEntry, side: ReviewSide, clauses: TextRange[], characters: TextRange[]) {
  if (!wrapClauseRanges(entry.element, clauses, side)) return;
  wrapTextRanges(entry.element, characters, side);
  entry.element.dataset.pagerootDiff = "text";
  entry.element.classList.add("pageroot-diff-text");
  appendLabel(entry.element, side === "before" ? "removed" : "added", side === "before" ? "删除" : "新增");
}

function applyTextDiff(beforeSection: HTMLElement, afterSection: HTMLElement, selectors: string[]) {
  const result = pairEntries(collectEntries(beforeSection, selectors), collectEntries(afterSection, selectors), false);
  result.pairs.forEach((pair) => {
    if (pair.before.text === pair.after.text) return;
    const ranges = changedTextRanges(pair.before, pair.after);
    markText(pair.before, "before", ranges.beforeClauses, ranges.beforeCharacters);
    markText(pair.after, "after", ranges.afterClauses, ranges.afterCharacters);
  });
  result.beforeOnly.forEach((entry) => {
    const clauses = clauseRanges(entry);
    markText(entry, "before", clauses, rangesForUnmatched(tokenize(entry.rawText), new Set()));
  });
  result.afterOnly.forEach((entry) => {
    const clauses = clauseRanges(entry);
    markText(entry, "after", clauses, rangesForUnmatched(tokenize(entry.rawText), new Set()));
  });
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
  const transparency = Math.max(0, Math.min(100, value)) / 100;
  const maskOpacity = 1 - transparency;
  const contextOpacity = .22 + transparency * .78;
  document.documentElement.style.setProperty("--pageroot-focus-mask-opacity", maskOpacity.toFixed(2));
  document.documentElement.style.setProperty("--pageroot-context-opacity", contextOpacity.toFixed(2));
  document.documentElement.style.setProperty("--pageroot-context-grayscale", (maskOpacity * .55).toFixed(2));
  document.documentElement.style.setProperty("--pageroot-context-saturation", (.7 + transparency * .3).toFixed(2));
}

export function setReviewPresentationMaskTransparency(
  beforeFrame: HTMLIFrameElement | null,
  afterFrame: HTMLIFrameElement | null,
  value: number,
) {
  setDocumentMaskTransparency(beforeFrame?.contentDocument, value);
  setDocumentMaskTransparency(afterFrame?.contentDocument, value);
}

export function setReviewPresentationScale(frame: HTMLIFrameElement | null, scale: number) {
  const document = frame?.contentDocument;
  if (!document?.documentElement) return;
  const compensation = 1 / Math.max(.32, Math.min(1, scale));
  document.documentElement.style.setProperty("--pageroot-review-ui-scale", compensation.toFixed(3));
}

function removeInjectedPresentation(document: Document) {
  document.querySelectorAll<HTMLElement>("[data-pageroot-overlay='true']").forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>("[data-pageroot-token='true']").forEach((element) => {
    const parent = element.parentNode;
    element.replaceWith(...element.childNodes);
    parent?.normalize();
  });
  document.querySelectorAll<HTMLElement>("[data-pageroot-clause='true']").forEach((element) => {
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

  if (filter === "all") {
    applyTextDiff(beforeSection, afterSection, targets.text);
    applyStructureDiff(beforeSection, afterSection, targets.structure);
    applyStyleDiff(beforeSection, afterSection, targets.style);
    return;
  }

  if (filter === "style") applyStyleDiff(beforeSection, afterSection, targets.style);
  if (filter === "structure") applyStructureDiff(beforeSection, afterSection, targets.structure);
  if (filter === "text") applyTextDiff(beforeSection, afterSection, targets.text);
}

export function clearReviewPresentation(frame: HTMLIFrameElement | null) {
  if (frame?.contentDocument) removeInjectedPresentation(frame.contentDocument);
}
