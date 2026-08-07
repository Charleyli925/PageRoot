import { isSafePngDataUrl } from "../lib/png-data-url.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
  instrumentPreviewHtml,
  sourceSha256,
} from "../lib/source-index.js";
import { resolvePageViewContext } from "../lib/page-view-context.js";

export const RUNTIME_VISUAL_PROJECTION_PROTOCOL =
  "pageroot-runtime-visual-projection";
export const RUNTIME_VISUAL_PROJECTION_VERSION = 2;

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
const CAPTURE_BOXES = new Set(["border", "content"]);
const RUNTIME_DEPENDENCY_TAGS = new Set([
  "base",
  "link",
  "script",
  "style",
]);
const BROAD_RUNTIME_HOST_MUTATION = /(?:appendChild|insertAdjacentHTML|replaceChildren|\.innerHTML\s*=|document\.createElement|echarts\.init|Highcharts\.chart|Plotly\.newPlot|vegaEmbed|d3\.select|new\s+Chart\s*\()/u;

function reusableSourceIndex(html, candidate) {
  return candidate?.source === html
    && typeof candidate.sourceSha256 === "string"
    && Array.isArray(candidate.elements)
    && candidate.byNodeId instanceof Map
    ? candidate
    : buildSourceIndex(html);
}

function captureBoxIdentity(sourceIndex, element) {
  const sourceBoxes = [];
  let current = element;
  while (current?.type === "element" && sourceBoxes.length < 7) {
    sourceBoxes.push([current.tagName, current.startTagRaw]);
    current = current.parentId
      ? sourceIndex.byNodeId.get(current.parentId)
      : null;
  }
  return sourceSha256(JSON.stringify({
    tagName: element.tagName,
    selector: element.selector,
    sourceBoxes,
  }));
}

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

function candidateReferenceTokens(element) {
  const tokens = new Set([element.selector]);
  for (const attribute of element.attributes ?? []) {
    if (attribute.name === "id" || attribute.name === "name") {
      tokens.add(attribute.value ?? attribute.rawValue ?? "");
    }
    if (attribute.name === "class") {
      String(attribute.value ?? attribute.rawValue ?? "")
        .split(/[\t\n\f\r ]+/u)
        .forEach((token) => tokens.add(token));
    }
    if (attribute.name.startsWith("data-")) {
      tokens.add(attribute.name);
      tokens.add(attribute.value ?? attribute.rawValue ?? "");
    }
  }
  return [...tokens].filter((token) => String(token).length >= 3);
}

function runtimeReferencedCandidates(sourceIndex, candidates) {
  const scripts = sourceIndex.elements.filter(
    (element) => element.tagName === "script",
  );
  if (scripts.length === 0) return [];
  const scriptSource = scripts.map((element) => element.raw).join("\n");
  const referenced = candidates.filter((candidate) => {
    const element = sourceIndex.byNodeId.get(candidate.sourceNodeId);
    return element?.type === "element" && candidateReferenceTokens(element)
      .some((token) => scriptSource.includes(token));
  });
  if (referenced.length > 0) return referenced;
  const hasExternalScript = scripts.some(
    (element) => (element.attributesByName.get("src")?.length ?? 0) === 1,
  );
  return hasExternalScript || BROAD_RUNTIME_HOST_MUTATION.test(scriptSource)
    ? candidates
    : [];
}

function captureCandidates(sourceIndex) {
  const placeholders = sourceIndex.elements
    .filter((element) => (
      VISUAL_HOST_TAGS.has(element.tagName)
      && sourceVisualPlaceholder(sourceIndex, element)
    ))
    .slice(0, MAX_CAPTURE_CANDIDATES)
    .map((element) => Object.freeze({
      sourceNodeId: element.nodeId,
      tagName: element.tagName,
      captureKey: captureBoxIdentity(sourceIndex, element),
    }));
  return runtimeReferencedCandidates(sourceIndex, placeholders);
}

function runtimeDependencySha256(sourceIndex, candidates) {
  const executableSources = sourceIndex.elements
    .filter((element) => RUNTIME_DEPENDENCY_TAGS.has(element.tagName))
    .map((element) => [element.tagName, element.selector, element.raw]);
  return sourceSha256(JSON.stringify({
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    candidates: candidates.map((candidate) => candidate.captureKey),
    executableSources,
  }));
}

function presentationDependencySha256(sourceIndex, entries) {
  return sourceSha256(JSON.stringify(entries.map((entry) => {
    const element = sourceIndex.byNodeId.get(entry.sourceNodeId);
    return {
      target: element?.type === "element"
        ? captureBoxIdentity(sourceIndex, element)
        : entry.sourceNodeId,
      classAdd: entry.classAdd,
      classRemove: entry.classRemove,
      ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
      ...(entry.open !== undefined ? { open: entry.open } : {}),
      ...(entry.ariaSelected !== undefined
        ? { ariaSelected: entry.ariaSelected }
        : {}),
      ...(entry.ariaExpanded !== undefined
        ? { ariaExpanded: entry.ariaExpanded }
        : {}),
    };
  })));
}

function presentationEntries(html, context, sourceIndex = null) {
  if (!context) return [];
  return resolvePageViewContext(html, context, sourceIndex).entries.map((item) => Object.freeze({
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
  sourceIndex: suppliedSourceIndex = null,
} = {}) {
  if (typeof html !== "string" || !html || typeof sourcePath !== "string") {
    return null;
  }
  const width = normalizedViewportWidth(viewportWidth);
  if (!width) return null;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  const candidates = captureCandidates(sourceIndex);
  const dependencySha256 = runtimeDependencySha256(sourceIndex, candidates);
  if (candidates.length === 0) {
    return Object.freeze({
      sourceSha256: sourceIndex.sourceSha256,
      dependencySha256,
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
    dependencySha256,
    candidates: Object.freeze(candidates),
    payload: Object.freeze({
      html: instrumentedHtml,
      sourcePath,
      sourceSha256: sourceIndex.sourceSha256,
      sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE,
      candidates: Object.freeze(candidates.map((candidate) => Object.freeze({
        sourceNodeId: candidate.sourceNodeId,
        tagName: candidate.tagName,
      }))),
      presentationEntries: Object.freeze(
        presentationEntries(html, pageViewContext, sourceIndex),
      ),
      viewport: Object.freeze({
        width,
        height: CAPTURE_VIEWPORT_HEIGHT,
      }),
    }),
  });
}

export function describeRuntimeVisualCapture({
  html,
  sourcePath,
  viewportWidth,
  pageViewContext = null,
  sourceIndex: suppliedSourceIndex = null,
} = {}) {
  if (typeof html !== "string" || !html || typeof sourcePath !== "string") {
    return null;
  }
  const width = normalizedViewportWidth(viewportWidth);
  if (!width) return null;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  const candidates = captureCandidates(sourceIndex);
  const entries = presentationEntries(html, pageViewContext, sourceIndex);
  return Object.freeze({
    sourceSha256: sourceIndex.sourceSha256,
    dependencySha256: runtimeDependencySha256(sourceIndex, candidates),
    candidates: Object.freeze(candidates),
    presentationEntries: Object.freeze(entries),
    presentationDependencySha256: presentationDependencySha256(
      sourceIndex,
      entries,
    ),
    viewportWidth: width,
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
  sourceIndex: suppliedSourceIndex = null,
} = {}) {
  if (
    typeof html !== "string"
    || typeof documentKey !== "string"
    || !documentKey
    || !Number.isSafeInteger(generation)
    || generation < 0
  ) return null;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  if (
    rawProjection?.protocol !== RUNTIME_VISUAL_PROJECTION_PROTOCOL
    || rawProjection?.version !== RUNTIME_VISUAL_PROJECTION_VERSION
    || rawProjection?.sourceSha256 !== sourceIndex.sourceSha256
    || !Array.isArray(rawProjection?.visuals)
    || rawProjection.visuals.length > MAX_CAPTURE_VISUALS
    || !Array.isArray(rawProjection?.deferredSourceNodeIds)
    || rawProjection.deferredSourceNodeIds.length > MAX_CAPTURE_VISUALS
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
  const candidatesByNodeId = new Map(
    captureCandidates(sourceIndex).map((candidate) => [
      candidate.sourceNodeId,
      candidate,
    ]),
  );
  for (const rawVisual of rawProjection.visuals) {
    const sourceNodeId = String(rawVisual?.sourceNodeId ?? "");
    const element = sourceIndex.byNodeId.get(sourceNodeId);
    const candidate = candidatesByNodeId.get(sourceNodeId);
    if (
      !sourceNodeId
      || sourceNodeCounts.get(sourceNodeId) !== 1
      || element?.type !== "element"
      || !VISUAL_HOST_TAGS.has(element.tagName)
      || !sourceVisualPlaceholder(sourceIndex, element)
      || !candidate
      || !isSafePngDataUrl(rawVisual?.dataUrl)
    ) continue;
    const width = Number(rawVisual.width);
    const height = Number(rawVisual.height);
    const layoutWidth = Number(rawVisual.layoutWidth);
    const layoutHeight = Number(rawVisual.layoutHeight);
    const captureBox = String(rawVisual.captureBox ?? "");
    if (
      ![width, height, layoutWidth, layoutHeight].every(Number.isFinite)
      || ![width, height, layoutWidth, layoutHeight].every((value) => value >= 1)
      || [width, height, layoutWidth, layoutHeight].some(
        (value) => value > MAX_VISUAL_PIXEL_DIMENSION,
      )
      || !CAPTURE_BOXES.has(captureBox)
      || (element.tagName === "tbody" && captureBox !== "border")
      || (element.tagName !== "tbody" && captureBox !== "content")
    ) continue;
    totalBytes += dataUrlByteLength(rawVisual.dataUrl);
    if (totalBytes > MAX_TOTAL_VISUAL_BYTES) return null;
    visuals.push(Object.freeze({
      sourceNodeId,
      tagName: element.tagName,
      captureKey: candidate.captureKey,
      width: Math.round(width),
      height: Math.round(height),
      layoutWidth: Math.round(layoutWidth),
      layoutHeight: Math.round(layoutHeight),
      captureBox,
      dataUrl: String(rawVisual.dataUrl),
    }));
  }

  const deferredCaptureKeys = [];
  const deferredSourceNodeIds = new Set();
  for (const rawSourceNodeId of rawProjection.deferredSourceNodeIds) {
    const sourceNodeId = String(rawSourceNodeId ?? "");
    const candidate = candidatesByNodeId.get(sourceNodeId);
    if (
      !sourceNodeId
      || deferredSourceNodeIds.has(sourceNodeId)
      || !candidate
    ) return null;
    deferredSourceNodeIds.add(sourceNodeId);
    deferredCaptureKeys.push(candidate.captureKey);
  }

  return Object.freeze({
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    visuals: Object.freeze(visuals),
    deferredCaptureKeys: Object.freeze(deferredCaptureKeys),
  });
}

export function rebindRuntimeVisualProjection({
  html,
  documentKey,
  generation,
  projection,
  sourceIndex: suppliedSourceIndex = null,
} = {}) {
  if (
    projection?.protocol !== RUNTIME_VISUAL_PROJECTION_PROTOCOL
    || projection?.version !== RUNTIME_VISUAL_PROJECTION_VERSION
  ) return null;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  const candidatesByCaptureKey = new Map();
  for (const candidate of captureCandidates(sourceIndex)) {
    if (candidatesByCaptureKey.has(candidate.captureKey)) {
      candidatesByCaptureKey.set(candidate.captureKey, null);
    } else {
      candidatesByCaptureKey.set(candidate.captureKey, candidate);
    }
  }
  return acceptRuntimeVisualProjection({
    html,
    documentKey,
    generation,
    sourceIndex,
    rawProjection: {
      protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
      version: RUNTIME_VISUAL_PROJECTION_VERSION,
      sourceSha256: sourceIndex.sourceSha256,
      visuals: projection.visuals.flatMap((visual) => {
        const candidate = candidatesByCaptureKey.get(visual.captureKey);
        if (!candidate || candidate.tagName !== visual.tagName) return [];
        return [{
          sourceNodeId: candidate.sourceNodeId,
          width: visual.width,
          height: visual.height,
          layoutWidth: visual.layoutWidth,
          layoutHeight: visual.layoutHeight,
          captureBox: visual.captureBox,
          dataUrl: visual.dataUrl,
        }];
      }),
      deferredSourceNodeIds: projection.deferredCaptureKeys.flatMap((captureKey) => {
        const candidate = candidatesByCaptureKey.get(captureKey);
        return candidate ? [candidate.sourceNodeId] : [];
      }),
    },
  });
}

export function mergeDeferredRuntimeVisualProjection({
  html,
  documentKey,
  generation,
  projection,
  fallbackProjection,
  sourceIndex: suppliedSourceIndex = null,
} = {}) {
  if (!projection || projection.deferredCaptureKeys.length === 0) {
    return projection ?? null;
  }
  const fallback = rebindRuntimeVisualProjection({
    html,
    documentKey,
    generation,
    projection: fallbackProjection,
    sourceIndex: suppliedSourceIndex,
  });
  if (!fallback) return projection;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  const candidatesByCaptureKey = new Map(
    captureCandidates(sourceIndex).map((candidate) => [
      candidate.captureKey,
      candidate,
    ]),
  );
  const fallbackByCaptureKey = new Map(
    fallback.visuals.map((visual) => [visual.captureKey, visual]),
  );
  const mergedByCaptureKey = new Map(
    projection.visuals.map((visual) => [visual.captureKey, visual]),
  );
  for (const captureKey of projection.deferredCaptureKeys) {
    const fallbackVisual = fallbackByCaptureKey.get(captureKey);
    if (fallbackVisual) mergedByCaptureKey.set(captureKey, fallbackVisual);
  }
  return acceptRuntimeVisualProjection({
    html,
    documentKey,
    generation,
    sourceIndex,
    rawProjection: {
      protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
      version: RUNTIME_VISUAL_PROJECTION_VERSION,
      sourceSha256: sourceIndex.sourceSha256,
      visuals: [...mergedByCaptureKey.values()]
        .slice(0, MAX_CAPTURE_VISUALS)
        .flatMap((visual) => {
        const candidate = candidatesByCaptureKey.get(visual.captureKey);
        if (!candidate) return [];
        return [{
          sourceNodeId: candidate.sourceNodeId,
          width: visual.width,
          height: visual.height,
          layoutWidth: visual.layoutWidth,
          layoutHeight: visual.layoutHeight,
          captureBox: visual.captureBox,
          dataUrl: visual.dataUrl,
        }];
      }),
      deferredSourceNodeIds: projection.deferredCaptureKeys.flatMap((captureKey) => {
        const candidate = candidatesByCaptureKey.get(captureKey);
        return candidate ? [candidate.sourceNodeId] : [];
      }),
    },
  });
}
