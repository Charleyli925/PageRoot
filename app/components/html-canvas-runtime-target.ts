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

const RUNTIME_TARGET_SELECTOR = "*";
const RUNTIME_TEXT_LIMIT = 320;

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
}: {
  sourceHost: HTMLElement;
  visualTarget: HTMLElement;
}): HtmlCanvasRuntimeVisualHint {
  const kind = runtimeVisualHintKind(visualTarget);
  return normalizeRuntimeVisualHint({
    runtimeGenerated: true,
    kind,
    label: explicitRuntimeLabel(sourceHost, visualTarget),
    renderedText: cleanVisibleText(visualTarget),
    relativePath: runtimeVisualPathWithin(sourceHost, visualTarget),
    relativeBox: normalizedRelativeBox(sourceHost, visualTarget),
  }) as HtmlCanvasRuntimeVisualHint;
}

export function runtimeVisualTargetAtPoint({
  documentNode,
  point,
  isProvenSourceElement,
}: {
  documentNode: Document;
  point: { clientX: number; clientY: number };
  isProvenSourceElement: ((element: HTMLElement) => boolean) | null;
}): HTMLElement | null {
  if (!isProvenSourceElement || !documentNode || !point) return null;
  const candidates = new Set<HTMLElement>();
  if (typeof documentNode.elementsFromPoint === "function") {
    documentNode.elementsFromPoint(point.clientX, point.clientY)
      .forEach((candidate) => {
        if (candidate instanceof HTMLElement) candidates.add(candidate);
      });
  }
  documentNode.querySelectorAll<HTMLElement>(
    "table, td, th, svg, canvas, [data-chart], [data-chart-root], [data-echarts], [role='img']",
  ).forEach((candidate) => candidates.add(candidate));
  const visualTargets = new Set<HTMLElement>();
  for (const candidate of candidates) {
    if (isProvenSourceElement(candidate)) continue;
    const rect = candidate.getBoundingClientRect();
    if (
      rect.width <= 0
      || rect.height <= 0
      || point.clientX < rect.left
      || point.clientX > rect.right
      || point.clientY < rect.top
      || point.clientY > rect.bottom
    ) continue;
    const visualTarget = runtimeVisualTargetElement(candidate);
    if (
      visualTarget
      && visualTarget !== candidate.ownerDocument.body
      && !isProvenSourceElement(visualTarget)
    ) visualTargets.add(visualTarget);
  }
  return [...visualTargets].sort((left, right) => (
    (left.getBoundingClientRect().width * left.getBoundingClientRect().height)
      - (right.getBoundingClientRect().width * right.getBoundingClientRect().height)
  ))[0] ?? null;
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
  const candidates = [
    ...Array.from(sourceHost.querySelectorAll<HTMLElement>(RUNTIME_TARGET_SELECTOR)),
    sourceHost,
  ];
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
    if (visualTarget && visualTarget !== sourceHost) visualTargets.add(visualTarget);
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
