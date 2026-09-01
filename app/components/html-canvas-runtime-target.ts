import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import { EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE } from "../domain/edit-runtime-contract.js";
import {
  normalizeRuntimeVisualHint,
  runtimeVisualHintKindLabel,
} from "../lib/runtime-comment-hint.js";
import type {
  HtmlCanvasRuntimeVisualHint,
  HtmlCanvasRuntimeVisualHintKind,
} from "./HtmlCanvasEditor.types";
import { readableLabel } from "./html-canvas-selection";

const RUNTIME_VISUAL_TARGET_SELECTOR = [
  "table",
  "td",
  "th",
  "svg",
  "canvas",
  "[data-chart]",
  "[data-chart-root]",
  "[data-echarts]",
  "[role='img']",
].join(", ");
const RUNTIME_VISUAL_TARGET_BUCKET_SIZE = 192;
const RUNTIME_HINT_CANDIDATE_LIMIT = 512;
const RUNTIME_TEXT_LIMIT = 320;

type RuntimeVisualTargetIndexEntry = {
  target: HTMLElement;
  left: number;
  top: number;
  right: number;
  bottom: number;
  area: number;
};

export type RuntimeVisualTargetIndex = {
  readonly documentNode: Document;
  readonly entries: RuntimeVisualTargetIndexEntry[];
  readonly buckets: Map<string, RuntimeVisualTargetIndexEntry[]>;
  hintCache: WeakMap<HTMLElement, {
    sourceHost: HTMLElement;
    hint: HtmlCanvasRuntimeVisualHint;
  }>;
  mutationObserver: MutationObserver | null;
  resizeObserver: ResizeObserver | null;
  resizeObserverPrimed: boolean;
  readonly resizeWindow: Window | null;
  resizeListener: (() => void) | null;
  scrollListener: (() => void) | null;
  dirty: boolean;
  disposed: boolean;
};

function isElementNode(value: unknown): value is HTMLElement {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { nodeType?: unknown }).nodeType === 1,
  );
}

function bucketCoordinate(value: number): number {
  return Math.floor(value / RUNTIME_VISUAL_TARGET_BUCKET_SIZE);
}

function bucketKey(x: number, y: number): string {
  return `${bucketCoordinate(x)}:${bucketCoordinate(y)}`;
}

function runtimeTargetRect(
  element: HTMLElement,
): RuntimeVisualTargetIndexEntry | null {
  const rect = element.getBoundingClientRect();
  if (
    !Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) return null;
  return {
    target: element,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    area: rect.width * rect.height,
  };
}

function markRuntimeVisualTargetIndexDirty(
  index: RuntimeVisualTargetIndex,
): void {
  if (index.disposed) return;
  index.dirty = true;
  index.hintCache = new WeakMap();
}

function addRuntimeVisualTargetIndexEntry(
  buckets: Map<string, RuntimeVisualTargetIndexEntry[]>,
  entry: RuntimeVisualTargetIndexEntry,
): void {
  const firstX = bucketCoordinate(entry.left);
  const lastX = bucketCoordinate(Math.max(entry.left, entry.right - 0.01));
  const firstY = bucketCoordinate(entry.top);
  const lastY = bucketCoordinate(Math.max(entry.top, entry.bottom - 0.01));
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      const key = `${x}:${y}`;
      const entries = buckets.get(key) || [];
      entries.push(entry);
      buckets.set(key, entries);
    }
  }
}

function rebuildRuntimeVisualTargetIndex(
  index: RuntimeVisualTargetIndex,
  isProvenSourceElement: ((element: HTMLElement) => boolean) | null,
): void {
  if (index.disposed) return;
  index.entries.length = 0;
  index.buckets.clear();
  index.hintCache = new WeakMap();
  if (!isProvenSourceElement) {
    index.dirty = false;
    return;
  }
  try {
    const visualTargets = new Set<HTMLElement>();
    index.documentNode
      .querySelectorAll<HTMLElement>(RUNTIME_VISUAL_TARGET_SELECTOR)
      .forEach((candidate) => {
        if (!isElementNode(candidate) || isProvenSourceElement(candidate)) return;
        const visualTarget = runtimeVisualTargetElement(candidate);
        if (
          visualTarget
          && visualTarget !== index.documentNode.body
          && visualTarget !== index.documentNode.documentElement
          && !isProvenSourceElement(visualTarget)
        ) visualTargets.add(visualTarget);
      });
    for (const visualTarget of visualTargets) {
      const entry = runtimeTargetRect(visualTarget);
      if (!entry) continue;
      index.entries.push(entry);
      addRuntimeVisualTargetIndexEntry(index.buckets, entry);
    }
  } catch {
    index.entries.length = 0;
    index.buckets.clear();
  }
  index.dirty = false;
}

export function createRuntimeVisualTargetIndex(
  documentNode: Document,
): RuntimeVisualTargetIndex {
  const index = {
    documentNode,
    entries: [],
    buckets: new Map<string, RuntimeVisualTargetIndexEntry[]>(),
    hintCache: new WeakMap(),
    mutationObserver: null,
    resizeObserver: null,
    resizeObserverPrimed: false,
    resizeWindow: documentNode.defaultView || null,
    resizeListener: null,
    scrollListener: null,
    dirty: true,
    disposed: false,
  } as RuntimeVisualTargetIndex;
  const MutationObserverConstructor = documentNode.defaultView?.MutationObserver;
  if (MutationObserverConstructor) {
    const observer = new MutationObserverConstructor(() => {
      markRuntimeVisualTargetIndexDirty(index);
    });
    observer.observe(documentNode.documentElement || documentNode, {
      attributes: true,
      attributeFilter: [
        "aria-label",
        "class",
        "data-chart",
        "data-chart-root",
        "data-echarts",
        "data-label",
        "hidden",
        "role",
        "style",
      ],
      childList: true,
      characterData: true,
      subtree: true,
    });
    index.mutationObserver = observer;
  }
  const ResizeObserverConstructor = documentNode.defaultView?.ResizeObserver;
  if (ResizeObserverConstructor) {
    const observer = new ResizeObserverConstructor(() => {
      if (!index.resizeObserverPrimed) {
        index.resizeObserverPrimed = true;
        return;
      }
      markRuntimeVisualTargetIndexDirty(index);
    });
    if (documentNode.documentElement) observer.observe(documentNode.documentElement);
    if (documentNode.body) observer.observe(documentNode.body);
    index.resizeObserver = observer;
  }
  const resizeListener = () => {
    markRuntimeVisualTargetIndexDirty(index);
  };
  index.resizeWindow?.addEventListener("resize", resizeListener);
  index.resizeListener = resizeListener;
  documentNode.addEventListener("scroll", resizeListener, true);
  index.scrollListener = resizeListener;
  return index;
}

export function disposeRuntimeVisualTargetIndex(
  index: RuntimeVisualTargetIndex | null | undefined,
): void {
  if (!index || index.disposed) return;
  index.disposed = true;
  index.mutationObserver?.disconnect();
  index.resizeObserver?.disconnect();
  if (index.resizeWindow && index.resizeListener) {
    index.resizeWindow.removeEventListener("resize", index.resizeListener);
  }
  if (index.scrollListener) {
    index.documentNode.removeEventListener("scroll", index.scrollListener, true);
  }
  index.entries.length = 0;
  index.buckets.clear();
  index.hintCache = new WeakMap();
}

function cleanVisibleText(element: HTMLElement): string {
  return String(element.innerText || element.textContent || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, RUNTIME_TEXT_LIMIT);
}

function hasChartIdentity(element: Element | null): boolean {
  if (!element) return false;
  const identity = [
    element.getAttribute("data-chart"),
    element.getAttribute("data-chart-root"),
    element.getAttribute("data-echarts"),
    element.getAttribute("role"),
    element.getAttribute("aria-label"),
    element.getAttribute("class"),
  ].filter(Boolean).join(" ").toLowerCase();
  return /chart|echarts|图表|graph|plot|visualization|可视化/u.test(identity)
    || element.getAttribute("role") === "img";
}

export function runtimeVisualTargetElement(
  element: HTMLElement | null,
): HTMLElement | null {
  if (!element) return null;
  const cell = element.closest<HTMLElement>("td, th");
  if (cell) return cell;
  const table = element.closest<HTMLElement>("table");
  if (table) return table;
  const svg = element.closest<HTMLElement>("svg");
  if (svg) return svg;
  const canvas = element.closest<HTMLElement>("canvas");
  if (canvas) return canvas;
  const chart = element.closest<HTMLElement>(
    "[data-chart], [data-chart-root], [data-echarts], [role='img']",
  );
  if (chart && !chart.hasAttribute(SOURCE_NODE_ATTRIBUTE)) return chart;
  return element;
}

export function runtimeVisualHintKind(
  element: HTMLElement | null,
): HtmlCanvasRuntimeVisualHintKind {
  if (!element) return "runtime-region";
  if (element.closest("td, th")) return "table-cell";
  if (element.closest("table")) return "table";
  const svg = element.closest<HTMLElement>("svg");
  if (svg) return hasChartIdentity(svg) ? "chart" : "svg";
  const canvas = element.closest<HTMLElement>("canvas");
  if (canvas) {
    return hasChartIdentity(canvas) || hasChartIdentity(canvas.parentElement)
      ? "chart"
      : "canvas";
  }
  if (hasChartIdentity(element)) return "chart";
  return "runtime-region";
}

function sameTagElementIndex(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  const sameTag = Array.from(parent.children).filter(
    (candidate) => candidate.localName === element.localName,
  );
  return Math.max(1, sameTag.indexOf(element) + 1);
}

export function runtimeVisualPathWithin(
  host: HTMLElement,
  target: HTMLElement,
): string {
  if (host === target) return ":scope";
  const parts: string[] = [];
  let current: HTMLElement | null = target;
  while (current && current !== host && parts.length < 32) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return "";
    const index = sameTagElementIndex(current);
    const currentTagName = current.localName;
    const sameTagCount = Array.from(parent.children).filter(
      (candidate: Element) => candidate.localName === currentTagName,
    ).length;
    parts.unshift(
      `${current.localName}${sameTagCount > 1 ? `:nth-of-type(${index})` : ""}`,
    );
    current = parent;
  }
  return current === host ? parts.join(" > ") : "";
}

function normalizedRelativeBox(
  host: HTMLElement,
  target: HTMLElement,
): HtmlCanvasRuntimeVisualHint["relativeBox"] | undefined {
  const hostRect = host.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (
    !Number.isFinite(hostRect.width)
    || !Number.isFinite(hostRect.height)
    || hostRect.width <= 0
    || hostRect.height <= 0
  ) return undefined;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: clamp((targetRect.left - hostRect.left) / hostRect.width),
    y: clamp((targetRect.top - hostRect.top) / hostRect.height),
    width: clamp(targetRect.width / hostRect.width),
    height: clamp(targetRect.height / hostRect.height),
  };
}

function explicitRuntimeLabel(
  host: HTMLElement,
  target: HTMLElement,
): string {
  const caption = target.matches("table")
    ? target.querySelector("caption")?.textContent
    : "";
  const explicit = [
    target.getAttribute("aria-label"),
    target.getAttribute("title"),
    target.getAttribute("data-label"),
    caption,
    host.getAttribute("aria-label"),
    host.getAttribute("title"),
    host.getAttribute("data-label"),
  ].map((value) => String(value || "").replace(/\s+/gu, " ").trim())
    .find(Boolean);
  if (explicit) return explicit;
  const visible = cleanVisibleText(target);
  const kind = runtimeVisualHintKind(target);
  if (visible && ["table", "table-cell"].includes(kind)) {
    return `${runtimeVisualHintKindLabel(kind)} · ${visible.slice(0, 90)}`;
  }
  if (visible && kind === "runtime-region") {
    return `${readableLabel(target)} · ${visible.slice(0, 90)}`;
  }
  return runtimeVisualHintKindLabel(kind);
}

export function runtimeVisualHintForTarget({
  sourceHost,
  visualTarget,
  cache,
}: {
  sourceHost: HTMLElement;
  visualTarget: HTMLElement;
  cache?: WeakMap<HTMLElement, {
    sourceHost: HTMLElement;
    hint: HtmlCanvasRuntimeVisualHint;
  }>;
}): HtmlCanvasRuntimeVisualHint {
  const cached = cache?.get(visualTarget);
  if (cached?.sourceHost === sourceHost) return cached.hint;
  const kind = runtimeVisualHintKind(visualTarget);
  const hint = normalizeRuntimeVisualHint({
    runtimeGenerated: true,
    kind,
    label: explicitRuntimeLabel(sourceHost, visualTarget),
    renderedText: cleanVisibleText(visualTarget),
    relativePath: runtimeVisualPathWithin(sourceHost, visualTarget),
    relativeBox: normalizedRelativeBox(sourceHost, visualTarget),
  }) as HtmlCanvasRuntimeVisualHint;
  cache?.set(visualTarget, { sourceHost, hint });
  return hint;
}

export function runtimeVisualTargetAtPoint({
  documentNode,
  point,
  isProvenSourceElement,
  runtimeVisualTargetIndex = null,
}: {
  documentNode: Document;
  point: { clientX: number; clientY: number };
  isProvenSourceElement: ((element: HTMLElement) => boolean) | null;
  runtimeVisualTargetIndex?: RuntimeVisualTargetIndex | null;
}): HTMLElement | null {
  if (!isProvenSourceElement || !documentNode || !point) return null;
  if (typeof documentNode.elementsFromPoint === "function") {
    for (const candidate of documentNode.elementsFromPoint(
      point.clientX,
      point.clientY,
    )) {
      if (!isElementNode(candidate) || isProvenSourceElement(candidate)) continue;
      const visualTarget = runtimeVisualTargetElement(candidate);
      if (
        visualTarget
        && visualTarget !== documentNode.body
        && visualTarget !== documentNode.documentElement
        && !isProvenSourceElement(visualTarget)
      ) return visualTarget;
    }
  }
  if (
    !runtimeVisualTargetIndex
    || runtimeVisualTargetIndex.documentNode !== documentNode
    || runtimeVisualTargetIndex.disposed
  ) return null;
  if (runtimeVisualTargetIndex.dirty) {
    rebuildRuntimeVisualTargetIndex(
      runtimeVisualTargetIndex,
      isProvenSourceElement,
    );
  }
  const entries = runtimeVisualTargetIndex.buckets.get(
    bucketKey(point.clientX, point.clientY),
  ) || [];
  let best: RuntimeVisualTargetIndexEntry | null = null;
  for (const entry of entries) {
    if (
      !entry.target.isConnected
      || isProvenSourceElement(entry.target)
      || point.clientX < entry.left
      || point.clientX > entry.right
      || point.clientY < entry.top
      || point.clientY > entry.bottom
    ) continue;
    if (!best || entry.area < best.area) best = entry;
  }
  return best?.target ?? null;
}

function visualBoxDistance(
  left: HtmlCanvasRuntimeVisualHint["relativeBox"] | undefined,
  right: HtmlCanvasRuntimeVisualHint["relativeBox"] | undefined,
): number {
  if (!left || !right) return 0.5;
  return Math.abs(left.x - right.x)
    + Math.abs(left.y - right.y)
    + Math.abs(left.width - right.width)
    + Math.abs(left.height - right.height);
}

function textSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.65;
  return 0;
}

function selectorsForRuntimeHintKind(
  kind: HtmlCanvasRuntimeVisualHintKind,
): string[] {
  switch (kind) {
    case "table":
      return ["table"];
    case "table-cell":
      return ["td, th"];
    case "chart":
      return [
        "svg",
        "canvas",
        "[data-chart]",
        "[data-chart-root]",
        "[data-echarts]",
        "[role='img']",
      ];
    case "svg":
      return ["svg"];
    case "canvas":
      return ["canvas"];
    case "runtime-region":
      return [
        "[data-chart]",
        "[data-chart-root]",
        "[data-echarts]",
        "[role='img']",
      ];
    default:
      return [];
  }
}

function appendRuntimeHintCandidate(
  candidates: HTMLElement[],
  seen: Set<HTMLElement>,
  candidate: unknown,
): boolean {
  if (
    !isElementNode(candidate)
    || seen.has(candidate)
    || candidates.length >= RUNTIME_HINT_CANDIDATE_LIMIT
  ) return false;
  seen.add(candidate);
  candidates.push(candidate);
  return true;
}

function pathCandidateForRuntimeHint(
  sourceHost: HTMLElement,
  relativePath: string | undefined,
): HTMLElement | null {
  if (!relativePath || relativePath === ":scope") return null;
  try {
    const candidate = sourceHost.querySelector(relativePath);
    return isElementNode(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function appendBoundedRuntimeRegionCandidates(
  sourceHost: HTMLElement,
  candidates: HTMLElement[],
  seen: Set<HTMLElement>,
): void {
  if (candidates.length >= RUNTIME_HINT_CANDIDATE_LIMIT) return;
  const showElement = sourceHost.ownerDocument.defaultView?.NodeFilter.SHOW_ELEMENT ?? 1;
  const walker = sourceHost.ownerDocument.createTreeWalker(sourceHost, showElement);
  let current = walker.nextNode();
  while (current && candidates.length < RUNTIME_HINT_CANDIDATE_LIMIT) {
    appendRuntimeHintCandidate(candidates, seen, current);
    current = walker.nextNode();
  }
}

/**
 * Best-effort visual restoration inside a proven source host. It never
 * returns a source-backed descendant and it never participates in authority.
 */
export function runtimeVisualTargetForHint(
  sourceHost: HTMLElement,
  rawHint: HtmlCanvasRuntimeVisualHint | null | undefined,
  options: {
    isProvenSourceElement?: ((element: HTMLElement) => boolean) | null;
  } = {},
): HTMLElement | null {
  const hint = normalizeRuntimeVisualHint(rawHint);
  if (!hint) return null;
  const visualTargets = new Set<HTMLElement>();
  const candidates: HTMLElement[] = [];
  const seenCandidates = new Set<HTMLElement>();
  appendRuntimeHintCandidate(
    candidates,
    seenCandidates,
    pathCandidateForRuntimeHint(sourceHost, hint.relativePath),
  );
  for (const selector of selectorsForRuntimeHintKind(hint.kind)) {
    if (candidates.length >= RUNTIME_HINT_CANDIDATE_LIMIT) break;
    try {
      for (const candidate of sourceHost.querySelectorAll(selector)) {
        appendRuntimeHintCandidate(candidates, seenCandidates, candidate);
        if (candidates.length >= RUNTIME_HINT_CANDIDATE_LIMIT) break;
      }
    } catch {
      // A persisted selector is only a hint. A malformed hint must not block
      // the remaining bounded visual candidates.
    }
  }
  if (hint.kind === "runtime-region") {
    appendBoundedRuntimeRegionCandidates(sourceHost, candidates, seenCandidates);
  }
  for (const candidate of candidates) {
    if (candidate === sourceHost) continue;
    if (options.isProvenSourceElement?.(candidate)) continue;
    // In a static or recovered frame there may be no private proof callback.
    // Public source markers are then only a conservative visual filter; they
    // never authorize a target. A generated node that copied those markers is
    // included when the current frame supplies the private proof callback.
    if (
      !options.isProvenSourceElement
      && (
        candidate.hasAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE)
        || candidate.hasAttribute(SOURCE_NODE_ATTRIBUTE)
      )
    ) continue;
    const visualTarget = runtimeVisualTargetElement(candidate);
    if (
      visualTarget
      && visualTarget !== sourceHost
      && runtimeVisualHintKind(visualTarget) === hint.kind
      && !options.isProvenSourceElement?.(visualTarget)
    ) visualTargets.add(visualTarget);
  }
  const ranked = [...visualTargets].map((candidate) => {
    const candidateKind = runtimeVisualHintKind(candidate);
    const candidateText = cleanVisibleText(candidate);
    const candidatePath = runtimeVisualPathWithin(sourceHost, candidate);
    const pathMatches = Boolean(
      hint.relativePath && candidatePath === hint.relativePath,
    );
    const visibleTextSimilarity = textSimilarity(
      candidateText,
      hint.renderedText || "",
    );
    const candidateLabel = explicitRuntimeLabel(sourceHost, candidate);
    const labelMatches = Boolean(
      hint.label
      && (
        candidateLabel === hint.label
        || candidateText.includes(hint.label)
      )
    );
    const boxDistance = visualBoxDistance(
      normalizedRelativeBox(sourceHost, candidate),
      hint.relativeBox,
    );
    const positionMatches = Boolean(
      hint.relativeBox && boxDistance <= 0.35,
    );
    const score = (
      (candidateKind === hint.kind ? 100 : 0)
      + (pathMatches ? 240 : 0)
      + (labelMatches ? 160 : 0)
      + (visibleTextSimilarity * 80)
      - (boxDistance * 20)
    );
    const textEvidence = visibleTextSimilarity >= 0.65 || labelMatches;
    const positionalEvidence = positionMatches
      && !hint.relativePath
      && !hint.renderedText;
    return {
      candidate,
      score,
      candidatePath,
      evidence: textEvidence || (pathMatches && !hint.renderedText) || positionalEvidence,
    };
  }).filter((entry) => entry.score >= 80)
    .filter((entry) => entry.evidence)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return null;
  const best = ranked[0];
  const second = ranked[1];
  if (second && Math.abs(best.score - second.score) < 1) return null;
  return best.candidate;
}
