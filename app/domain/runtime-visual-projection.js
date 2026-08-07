import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
  instrumentPreviewHtml,
  sourceSha256,
} from "../lib/source-index.js";
import {
  createTargetRef,
  resolveTargetRef,
} from "../lib/target-resolver.js";
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
const VIEWPORT_BUCKET_WIDTH = 64;
const CAPTURE_VIEWPORT_HEIGHT = 1_200;
const VISUAL_HOST_TAGS = new Set([
  "article",
  "aside",
  "canvas",
  "div",
  "figure",
  "figcaption",
  "li",
  "main",
  "section",
  "span",
  "svg",
  "td",
  "th",
  "tbody",
]);
const CAPTURE_BOXES = new Set(["border", "content"]);
const RUNTIME_CONTENT_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RAW_PROJECTION_KEYS = new Set([
  "protocol",
  "version",
  "sourceSha256",
  "visuals",
  "deferredSourceNodeIds",
]);
const RAW_VISUAL_KEYS = new Set([
  "sourceNodeId",
  "width",
  "height",
  "layoutWidth",
  "layoutHeight",
  "deviceScaleFactor",
  "captureBox",
  "crop",
  "sizingMode",
  "runtimeContentSha256",
  "byteLength",
  "pngBytes",
]);
const RUNTIME_DEPENDENCY_TAGS = new Set([
  "base",
  "link",
  "script",
  "style",
]);
const BROAD_RUNTIME_HOST_MUTATION = /(?:appendChild|insertAdjacentHTML|replaceChildren|\.innerHTML\s*=|document\.createElement|echarts\.init|Highcharts\.chart|Plotly\.newPlot|vegaEmbed|d3\.select|new\s+Chart\s*\()/u;
const acceptedProjectionAuthority = new WeakSet();

function reusableSourceIndex(html, candidate) {
  return candidate?.source === html
    && typeof candidate.sourceSha256 === "string"
    && Array.isArray(candidate.elements)
    && candidate.byNodeId instanceof Map
    ? candidate
    : buildSourceIndex(html);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function immutableTargetRef(targetRef) {
  const fingerprint = targetRef.fingerprint
    ? Object.freeze({
      ...targetRef.fingerprint,
      stableAttributes: Object.freeze({
        ...(targetRef.fingerprint.stableAttributes ?? {}),
      }),
      ancestorFingerprint: Object.freeze([
        ...(targetRef.fingerprint.ancestorFingerprint ?? []),
      ]),
    })
    : undefined;
  return Object.freeze({
    ...targetRef,
    ...(targetRef.sourceAnchor
      ? { sourceAnchor: Object.freeze({ ...targetRef.sourceAnchor }) }
      : {}),
    ...(fingerprint ? { fingerprint } : {}),
  });
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
  const hasExternalScript = scripts.some(
    (element) => (element.attributesByName.get("src")?.length ?? 0) === 1,
  );
  if (hasExternalScript || BROAD_RUNTIME_HOST_MUTATION.test(scriptSource)) {
    return candidates;
  }
  return referenced;
}

function captureCandidates(sourceIndex) {
  const placeholders = sourceIndex.elements
    .filter((element) => (
      VISUAL_HOST_TAGS.has(element.tagName)
      && sourceVisualPlaceholder(sourceIndex, element)
    ))
    .slice(0, MAX_CAPTURE_CANDIDATES)
    .map((element) => {
      const hostTargetRef = immutableTargetRef(createTargetRef(
        sourceIndex,
        element,
        { level: "subregion" },
      ));
      return Object.freeze({
        sourceNodeId: element.nodeId,
        tagName: element.tagName,
        captureKey: captureBoxIdentity(sourceIndex, element),
        hostTargetRef,
      });
    });
  return runtimeReferencedCandidates(sourceIndex, placeholders);
}

function runtimeDependencySha256(sourceIndex, candidates) {
  const scripts = sourceIndex.elements.filter(
    (element) => element.tagName === "script",
  );
  const scriptSource = scripts.map((element) => element.raw).join("\n");
  const executableSources = sourceIndex.elements
    .filter((element) => RUNTIME_DEPENDENCY_TAGS.has(element.tagName))
    .map((element) => [element.tagName, element.selector, element.raw]);
  const referencedDataSources = scriptSource
    ? sourceIndex.elements
      .filter((element) => (
        !RUNTIME_DEPENDENCY_TAGS.has(element.tagName)
        && candidateReferenceTokens(element).some(
          (token) => scriptSource.includes(token),
        )
      ))
      .map((element) => [element.tagName, element.selector, element.raw])
    : [];
  return sourceSha256(JSON.stringify({
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    candidates: candidates.map((candidate) => candidate.captureKey),
    executableSources,
    referencedDataSources,
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

function viewportBucket(width) {
  return Math.floor(width / VIEWPORT_BUCKET_WIDTH);
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
      viewportBucket: viewportBucket(width),
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
    viewportBucket: viewportBucket(width),
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
    viewportBucket: viewportBucket(width),
  });
}

function normalizedPngBytes(value) {
  let bytes;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    return null;
  }
  if (
    bytes.byteLength < 33
    || bytes.byteLength > 2_000_000
    || ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (expected, index) => bytes[index] === expected,
    )
    || ![73, 72, 68, 82].every(
      (expected, index) => bytes[12 + index] === expected,
    )
    || ![73, 69, 78, 68, 174, 66, 96, 130].every(
      (expected, index) => bytes[bytes.byteLength - 8 + index] === expected,
    )
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || width > MAX_VISUAL_PIXEL_DIMENSION
    || height > MAX_VISUAL_PIXEL_DIMENSION
  ) return null;
  return { bytes: new Uint8Array(bytes), width, height };
}

function pngSha256(bytes) {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

function finalizeAcceptedProjection(value) {
  const projection = Object.freeze(value);
  acceptedProjectionAuthority.add(projection);
  return projection;
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
    || rawProjection.visuals.length
      + rawProjection.deferredSourceNodeIds.length > MAX_CAPTURE_VISUALS
    || Object.keys(rawProjection).some((key) => !RAW_PROJECTION_KEYS.has(key))
  ) return null;

  const sourceNodeCounts = new Map();
  for (const rawVisual of rawProjection.visuals) {
    if (
      !isRecord(rawVisual)
      || Object.keys(rawVisual).some((key) => !RAW_VISUAL_KEYS.has(key))
    ) continue;
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
    ) continue;
    const png = normalizedPngBytes(rawVisual?.pngBytes);
    if (!png) continue;
    const pngBytes = png.bytes;
    const width = Number(rawVisual.width);
    const height = Number(rawVisual.height);
    const layoutWidth = Number(rawVisual.layoutWidth);
    const layoutHeight = Number(rawVisual.layoutHeight);
    const deviceScaleFactor = Number(rawVisual.deviceScaleFactor);
    const captureBox = String(rawVisual.captureBox ?? "");
    const sizingMode = String(rawVisual.sizingMode ?? "");
    const runtimeContentSha256 = String(
      rawVisual.runtimeContentSha256 ?? "",
    );
    const byteLength = Number(rawVisual.byteLength);
    const crop = rawVisual.crop;
    if (
      ![width, height, layoutWidth, layoutHeight].every(Number.isFinite)
      || ![width, height, layoutWidth, layoutHeight].every((value) => value >= 1)
      || [width, height, layoutWidth, layoutHeight].some(
        (value) => value > MAX_VISUAL_PIXEL_DIMENSION,
      )
      || Math.round(width) !== png.width
      || Math.round(height) !== png.height
      || !CAPTURE_BOXES.has(captureBox)
      || (element.tagName === "tbody" && captureBox !== "border")
      || (element.tagName !== "tbody" && captureBox !== "content")
      || !Number.isFinite(deviceScaleFactor)
      || deviceScaleFactor < 0.5
      || deviceScaleFactor > 8
      || sizingMode !== "contain"
      || !RUNTIME_CONTENT_SHA256_PATTERN.test(runtimeContentSha256)
      || runtimeContentSha256 !== pngSha256(pngBytes)
      || !Number.isSafeInteger(byteLength)
      || byteLength !== pngBytes.byteLength
      || !isRecord(crop)
      || Object.keys(crop).some(
        (key) => !["x", "y", "width", "height"].includes(key),
      )
      || ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
      || crop.x < 0
      || crop.y < 0
      || crop.width < 1
      || crop.height < 1
      || crop.x > MAX_VIEWPORT_WIDTH
      || crop.y > CAPTURE_VIEWPORT_HEIGHT
      || crop.width > MAX_VISUAL_PIXEL_DIMENSION
      || crop.height > MAX_VISUAL_PIXEL_DIMENSION
      || crop.x + crop.width > MAX_VIEWPORT_WIDTH
      || crop.y + crop.height > CAPTURE_VIEWPORT_HEIGHT
      || Math.abs(crop.width - layoutWidth) > 2
      || Math.abs(crop.height - layoutHeight) > 2
    ) continue;
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_VISUAL_BYTES) return null;
    visuals.push(Object.freeze({
      sourceNodeId,
      tagName: element.tagName,
      captureKey: candidate.captureKey,
      hostTargetRef: candidate.hostTargetRef,
      width: Math.round(width),
      height: Math.round(height),
      layoutWidth: Math.round(layoutWidth),
      layoutHeight: Math.round(layoutHeight),
      deviceScaleFactor,
      captureBox,
      crop: Object.freeze({
        x: Math.round(crop.x),
        y: Math.round(crop.y),
        width: Math.round(crop.width),
        height: Math.round(crop.height),
      }),
      sizingMode,
      runtimeContentSha256,
      byteLength,
      pngBytes,
    }));
  }

  const deferredCaptureKeys = [];
  const deferredTargets = [];
  const deferredSourceNodeIds = new Set();
  const visualSourceNodeIds = new Set(
    visuals.map((visual) => visual.sourceNodeId),
  );
  for (const rawSourceNodeId of rawProjection.deferredSourceNodeIds) {
    const sourceNodeId = String(rawSourceNodeId ?? "");
    const candidate = candidatesByNodeId.get(sourceNodeId);
    if (
      !sourceNodeId
      || deferredSourceNodeIds.has(sourceNodeId)
      || visualSourceNodeIds.has(sourceNodeId)
      || !candidate
    ) return null;
    deferredSourceNodeIds.add(sourceNodeId);
    deferredCaptureKeys.push(candidate.captureKey);
    deferredTargets.push(Object.freeze({
      captureKey: candidate.captureKey,
      tagName: candidate.tagName,
      hostTargetRef: candidate.hostTargetRef,
    }));
  }

  return finalizeAcceptedProjection({
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    visuals: Object.freeze(visuals),
    deferredCaptureKeys: Object.freeze(deferredCaptureKeys),
    deferredTargets: Object.freeze(deferredTargets),
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
    || !acceptedProjectionAuthority.has(projection)
    || typeof documentKey !== "string"
    || !documentKey
    || projection.documentKey !== documentKey
    || !Number.isSafeInteger(generation)
    || generation < 0
  ) return null;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  const candidatesByNodeId = new Map(
    captureCandidates(sourceIndex).map((candidate) => [
      candidate.sourceNodeId,
      candidate,
    ]),
  );
  const resolveCandidate = (visual) => {
    if (!visual?.hostTargetRef) return null;
    let resolution;
    try {
      resolution = resolveTargetRef(sourceIndex, visual.hostTargetRef);
    } catch {
      return null;
    }
    if (!resolution?.target || !["exact", "rebound"].includes(resolution.resolution)) {
      return null;
    }
    const candidate = candidatesByNodeId.get(resolution.target.nodeId);
    return candidate?.tagName === visual.tagName ? candidate : null;
  };
  const visuals = [];
  const usedVisualNodeIds = new Set();
  for (const visual of projection.visuals) {
    const candidate = resolveCandidate(visual);
    if (!candidate || usedVisualNodeIds.has(candidate.sourceNodeId)) continue;
    usedVisualNodeIds.add(candidate.sourceNodeId);
    visuals.push(Object.freeze({
      ...visual,
      sourceNodeId: candidate.sourceNodeId,
      tagName: candidate.tagName,
      captureKey: candidate.captureKey,
      hostTargetRef: candidate.hostTargetRef,
    }));
  }
  const deferredTargets = [];
  const usedDeferredNodeIds = new Set();
  for (const deferredTarget of projection.deferredTargets ?? []) {
    const candidate = resolveCandidate(deferredTarget);
    if (!candidate || usedDeferredNodeIds.has(candidate.sourceNodeId)) continue;
    usedDeferredNodeIds.add(candidate.sourceNodeId);
    deferredTargets.push(Object.freeze({
      captureKey: candidate.captureKey,
      tagName: candidate.tagName,
      hostTargetRef: candidate.hostTargetRef,
    }));
  }
  return finalizeAcceptedProjection({
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    visuals: Object.freeze(visuals),
    deferredCaptureKeys: Object.freeze(
      deferredTargets.map((target) => target.captureKey),
    ),
    deferredTargets: Object.freeze(deferredTargets),
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
  if (
    typeof html !== "string"
    || !projection
    || !acceptedProjectionAuthority.has(projection)
    || !Array.isArray(projection.deferredCaptureKeys)
  ) return null;
  const sourceIndex = reusableSourceIndex(html, suppliedSourceIndex);
  if (
    typeof documentKey !== "string"
    || !documentKey
    || projection.documentKey !== documentKey
    || projection.sourceSha256 !== sourceIndex.sourceSha256
    || !Number.isSafeInteger(generation)
    || generation < 0
  ) return null;
  if (projection.deferredCaptureKeys.length === 0) return projection;
  const fallback = rebindRuntimeVisualProjection({
    html,
    documentKey,
    generation,
    projection: fallbackProjection,
    sourceIndex,
  });
  if (!fallback) return projection;
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
  return finalizeAcceptedProjection({
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    documentKey,
    generation,
    sourceSha256: projection.sourceSha256,
    visuals: Object.freeze(
      [...mergedByCaptureKey.values()].slice(0, MAX_CAPTURE_VISUALS),
    ),
    deferredCaptureKeys: projection.deferredCaptureKeys,
    deferredTargets: projection.deferredTargets,
  });
}
