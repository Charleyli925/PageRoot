import { isSafePngDataUrl } from "../lib/png-data-url.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
  instrumentPreviewHtml,
} from "../lib/source-index.js";
import { resolvePageViewContext } from "../lib/page-view-context.js";

export const RUNTIME_VISUAL_PROJECTION_PROTOCOL =
  "pageroot-runtime-visual-projection";
export const RUNTIME_VISUAL_PROJECTION_VERSION = 1;

const MAX_CAPTURE_CANDIDATES = 256;
const MAX_CAPTURE_VISUALS = 32;
const MAX_TOTAL_VISUAL_BYTES = 16_000_000;
const MAX_VISUAL_PIXEL_DIMENSION = 4_096;
const MIN_VIEWPORT_WIDTH = 320;
const MAX_VIEWPORT_WIDTH = 4_096;
const CAPTURE_VIEWPORT_HEIGHT = 1_200;
const VISUAL_HOST_TAGS = new Set([
  "article",
  "aside",
  "div",
  "figure",
  "figcaption",
  "li",
  "main",
  "section",
  "span",
  "td",
  "th",
  "tbody",
]);

function sourceVisualPlaceholder(sourceIndex, element) {
  if (
    !element?.contentRange
    || !Number.isInteger(element.contentRange.startOffset)
    || !Number.isInteger(element.contentRange.endOffset)
  ) return false;
  const innerHtml = sourceIndex.source.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  return innerHtml.replace(/<!--[\s\S]*?-->/gu, "").trim().length === 0;
}

function captureCandidates(sourceIndex) {
  return sourceIndex.elements
    .filter((element) => (
      VISUAL_HOST_TAGS.has(element.tagName)
      && sourceVisualPlaceholder(sourceIndex, element)
    ))
    .slice(0, MAX_CAPTURE_CANDIDATES)
    .map((element) => Object.freeze({
      sourceNodeId: element.nodeId,
      tagName: element.tagName,
    }));
}

function presentationEntries(html, context) {
  if (!context) return [];
  return resolvePageViewContext(html, context).entries.map((item) => Object.freeze({
    sourceNodeId: item.sourceNodeId,
    classAdd: Object.freeze([...(item.entry.classAdd ?? [])]),
    classRemove: Object.freeze([...(item.entry.classRemove ?? [])]),
    ...(item.entry.hidden !== undefined ? { hidden: item.entry.hidden } : {}),
    ...(item.entry.open !== undefined ? { open: item.entry.open } : {}),
    ...(item.entry.ariaSelected !== undefined
      ? { ariaSelected: item.entry.ariaSelected }
      : {}),
    ...(item.entry.ariaExpanded !== undefined
      ? { ariaExpanded: item.entry.ariaExpanded }
      : {}),
  }));
}

function normalizedViewportWidth(value) {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return null;
  return Math.max(MIN_VIEWPORT_WIDTH, Math.min(MAX_VIEWPORT_WIDTH, width));
}

export function prepareRuntimeVisualCapture({
  html,
  sourcePath,
  viewportWidth,
  pageViewContext = null,
} = {}) {
  if (typeof html !== "string" || !html || typeof sourcePath !== "string") {
    return null;
  }
  const width = normalizedViewportWidth(viewportWidth);
  if (!width) return null;
  const sourceIndex = buildSourceIndex(html);
  const candidates = captureCandidates(sourceIndex);
  if (candidates.length === 0) {
    return Object.freeze({
      sourceSha256: sourceIndex.sourceSha256,
      candidates: Object.freeze([]),
      payload: null,
    });
  }
  let instrumentedHtml;
  try {
    instrumentedHtml = instrumentPreviewHtml(sourceIndex, {
      attributeName: SOURCE_NODE_ATTRIBUTE,
    }).html;
  } catch {
    return null;
  }
  return Object.freeze({
    sourceSha256: sourceIndex.sourceSha256,
    candidates: Object.freeze(candidates),
    payload: Object.freeze({
      html: instrumentedHtml,
      sourcePath,
      sourceSha256: sourceIndex.sourceSha256,
      sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE,
      candidates: Object.freeze(candidates),
      presentationEntries: Object.freeze(
        presentationEntries(html, pageViewContext),
      ),
      viewport: Object.freeze({
        width,
        height: CAPTURE_VIEWPORT_HEIGHT,
      }),
    }),
  });
}

function dataUrlByteLength(dataUrl) {
  return Math.ceil(String(dataUrl ?? "").length * 0.75);
}

export function acceptRuntimeVisualProjection({
  html,
  documentKey,
  generation,
  rawProjection,
} = {}) {
  if (
    typeof html !== "string"
    || typeof documentKey !== "string"
    || !documentKey
    || !Number.isSafeInteger(generation)
    || generation < 0
  ) return null;
  const sourceIndex = buildSourceIndex(html);
  if (
    rawProjection?.protocol !== RUNTIME_VISUAL_PROJECTION_PROTOCOL
    || rawProjection?.version !== RUNTIME_VISUAL_PROJECTION_VERSION
    || rawProjection?.sourceSha256 !== sourceIndex.sourceSha256
    || !Array.isArray(rawProjection?.visuals)
    || rawProjection.visuals.length > MAX_CAPTURE_VISUALS
  ) return null;

  const sourceNodeCounts = new Map();
  for (const rawVisual of rawProjection.visuals) {
    const sourceNodeId = String(rawVisual?.sourceNodeId ?? "");
    sourceNodeCounts.set(
      sourceNodeId,
      (sourceNodeCounts.get(sourceNodeId) ?? 0) + 1,
    );
  }

  let totalBytes = 0;
  const visuals = [];
  for (const rawVisual of rawProjection.visuals) {
    const sourceNodeId = String(rawVisual?.sourceNodeId ?? "");
    const element = sourceIndex.byNodeId.get(sourceNodeId);
    if (
      !sourceNodeId
      || sourceNodeCounts.get(sourceNodeId) !== 1
      || element?.type !== "element"
      || !VISUAL_HOST_TAGS.has(element.tagName)
      || !sourceVisualPlaceholder(sourceIndex, element)
      || !isSafePngDataUrl(rawVisual?.dataUrl)
    ) continue;
    const width = Number(rawVisual.width);
    const height = Number(rawVisual.height);
    const layoutWidth = Number(rawVisual.layoutWidth);
    const layoutHeight = Number(rawVisual.layoutHeight);
    if (
      ![width, height, layoutWidth, layoutHeight].every(Number.isFinite)
      || ![width, height, layoutWidth, layoutHeight].every((value) => value >= 1)
      || [width, height, layoutWidth, layoutHeight].some(
        (value) => value > MAX_VISUAL_PIXEL_DIMENSION,
      )
    ) continue;
    totalBytes += dataUrlByteLength(rawVisual.dataUrl);
    if (totalBytes > MAX_TOTAL_VISUAL_BYTES) return null;
    visuals.push(Object.freeze({
      sourceNodeId,
      tagName: element.tagName,
      width: Math.round(width),
      height: Math.round(height),
      layoutWidth: Math.round(layoutWidth),
      layoutHeight: Math.round(layoutHeight),
      dataUrl: String(rawVisual.dataUrl),
    }));
  }

  return Object.freeze({
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    visuals: Object.freeze(visuals),
  });
}
