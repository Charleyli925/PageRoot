import { createHash, randomBytes } from "node:crypto";
import { parse as parseHtml } from "parse5";

import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
  isRuntimeVisualSessionIdentity,
  isRuntimeVisualSourceSha256,
} from "../app/domain/runtime-visual-contract.js";

const RUNTIME_SNAPSHOT_CAPTURE_WORLD_ID = 91_117;
const RUNTIME_SNAPSHOT_CAPTURE_PARTITION_PREFIX = "pageroot-runtime-snapshot-";
const MAX_PATH_DEPTH = 256;
const MAX_IDENTITY_VALUE_LENGTH = 2_048;
const OWNER_CLEANUP_GRACE_MS = 250;
// Confirming that a host settled costs a second frame, and that cost is shared
// by every candidate in one request rather than granted to each. Six attempts
// per host reads as ~1.1s against the 4s owner deadline, but a page of twelve
// charts then asks for ~13s and the deadline fires first — which is exactly how
// authored pages went from twelve verified hosts to none.
//
// The second frame therefore waits for the next paint rather than a fixed
// interval: a chart still animating repaints immediately, and a static one falls
// back quickly, so every host on a busy page can be checked inside one shared
// budget.
const CAPTURE_STABILITY_ATTEMPTS = 6;
const CAPTURE_STABILITY_FRAME_FALLBACK_MS = 60;
const CAPTURE_STABILITY_BUDGET_MS = 1_500;
// Stability is a three-way fact, not a flag. "moving" means two frames were
// compared and differed, which is the only reading that makes a surface digest
// untrustworthy. "unknown" means no second frame was affordable, which is not
// evidence of motion — treating the two alike silently halved real chart
// detection on authored pages.
const CAPTURE_SETTLED = "settled";
const CAPTURE_MOVING = "moving";
const CAPTURE_STABILITY_UNKNOWN = "unknown";
// Upper bound on waiting for the frame that reflects a probe scroll. An
// offscreen compositor delivers it in one frame interval; this only caps a
// page that stops repainting entirely.
const SCROLLED_FRAME_FALLBACK_MS = 250;
const RUNTIME_VISUAL_PAGE_BUDGET = RUNTIME_VISUAL_CONTRACT.pageBudget;
const CAPTURE_REQUEST_KEYS = new Set([
  "contractVersion",
  "captureSessionId",
  "sourceSha256",
  "side",
  "html",
  "candidates",
  "viewport",
]);
const CAPTURE_CANDIDATE_KEYS = new Set([
  "key",
  "path",
  "tagName",
  "kind",
  "identityAttributes",
]);
const OWNER_RECT_KEYS = new Set([
  "key",
  "state",
  "rect",
  // The host's own size, which the probe reports whether or not the host fits in
  // the capture viewport. A chart wider or taller than the viewport is still
  // comparable through its drawing surface.
  "layout",
  "renderedText",
  "surfaceDigest",
  "scrolled",
]);
// The digest itself is a short decimal fold; these bound what it is folded
// over so one hostile canvas cannot stall the owner deadline.
const SURFACE_DIGEST_LENGTH_LIMIT = 64;
const SURFACE_PIXEL_LIMIT = RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels;
const SURFACE_MARKUP_LIMIT = 2 * 1024 * 1024;
// How far up the tree a composite-time effect is still folded in. Deeper than
// this a filter or opacity would be a page-wide treatment, not a chart fact.
const PRESENTATION_ANCESTOR_DEPTH = 16;
// Resolved paint is read per drawable node, so the count is bounded the same
// way visible text already is.
const SURFACE_DRAWABLE_LIMIT = RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms;
const RECT_KEYS = new Set(["x", "y", "width", "height"]);

class CaptureCancelledError extends Error {
  constructor() {
    super("Runtime snapshot capture was cancelled.");
  }
}

class CaptureTimedOutError extends Error {
  constructor() {
    super("Runtime snapshot capture timed out.");
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function normalizedString(value, maximum) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function sourceSha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function pngSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function renderedTextSha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function result(outcome, reason) {
  return Object.freeze({ outcome, reason });
}

function captureResult(request, snapshots) {
  return Object.freeze({
    outcome: "captured",
    envelope: Object.freeze({
      contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
      sessionId: request.captureSessionId,
      sourceSha256: request.sourceSha256,
      runtimeVisualSnapshots: Object.freeze(snapshots),
    }),
  });
}

function safeScriptValue(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

function validAttributeName(value) {
  return typeof value === "string"
    && /^[A-Za-z_:][A-Za-z0-9:_.-]{0,127}$/u.test(value)
    && !value.toLowerCase().startsWith("data-pageroot-");
}

function validCandidateKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function validTagName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9:-]{0,63}$/u.test(value);
}

function validKind(value) {
  return value === "canvas" || value === "svg" || value === "host";
}

function normalizeIdentityAttributes(value) {
  if (
    !Array.isArray(value)
    || value.length > RUNTIME_VISUAL_CONTRACT.identityAttributeLimit
  ) return null;
  const names = new Set();
  const attributes = [];
  for (const item of value) {
    if (
      !Array.isArray(item)
      || item.length !== 2
      || !validAttributeName(item[0])
      || !normalizedString(item[1], MAX_IDENTITY_VALUE_LENGTH)
      || names.has(item[0])
    ) return null;
    names.add(item[0]);
    attributes.push(Object.freeze([item[0], item[1]]));
  }
  return Object.freeze(attributes);
}

function normalizeCandidate(value, keys) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !CAPTURE_CANDIDATE_KEYS.has(key))
  ) return null;
  const key = validCandidateKey(value.key) ? value.key : null;
  const tagName = validTagName(value.tagName) ? value.tagName : null;
  const kind = validKind(value.kind) ? value.kind : null;
  const identityAttributes = normalizeIdentityAttributes(value.identityAttributes);
  if (
    !key
    || keys.has(key)
    || !tagName
    || !kind
    || !identityAttributes
    || (kind === "canvas" && tagName.toLowerCase() !== "canvas")
    || (kind === "svg" && tagName.toLowerCase() !== "svg")
    || (kind === "host" && identityAttributes.length === 0)
    || !Array.isArray(value.path)
    || value.path.length > MAX_PATH_DEPTH
  ) return null;
  const path = value.path.map((index) => boundedInteger(index, 0, 65_535));
  if (path.some((index) => index === null)) return null;
  keys.add(key);
  return Object.freeze({
    key,
    path: Object.freeze(path),
    tagName,
    kind,
    identityAttributes,
  });
}

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => typeof child?.tagName === "string");
}

function staticHtmlElement(document) {
  return elementChildren(document).find((node) => node.tagName === "html") || null;
}

function staticTagMatches(element, tagName) {
  const sourceTag = String(element?.tagName || "");
  if (!sourceTag) return false;
  return element?.namespaceURI === "http://www.w3.org/1999/xhtml"
    ? sourceTag.toLowerCase() === tagName.toLowerCase()
    : sourceTag === tagName;
}

function staticAttribute(element, name) {
  const attributes = Array.isArray(element?.attrs) ? element.attrs : [];
  const exact = attributes.find((attribute) => attribute.name === name);
  if (exact) return String(exact.value ?? "");
  if (element?.namespaceURI !== "http://www.w3.org/1999/xhtml") return null;
  const normalized = name.toLowerCase();
  const htmlAttribute = attributes.find((attribute) => attribute.name.toLowerCase() === normalized);
  return htmlAttribute ? String(htmlAttribute.value ?? "") : null;
}

function staticSourceContentIsEmpty(node) {
  return (node?.childNodes || []).every((child) => {
    if (child?.nodeName === "#comment") return true;
    if (child?.nodeName === "#text") return !String(child.value || "").trim();
    return false;
  });
}

function staticMatchesBinding(element, candidate) {
  if (!staticTagMatches(element, candidate.tagName)) return false;
  if (candidate.kind === "host" && !staticSourceContentIsEmpty(element)) return false;
  return candidate.identityAttributes.every(([name, value]) => (
    staticAttribute(element, name) === value
  ));
}

function staticElements(root) {
  const elements = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.tagName === "string") elements.push(node);
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(root);
  return elements;
}

function staticChildAtPath(root, path) {
  let element = root;
  for (const index of path) {
    element = elementChildren(element)[index] || null;
    if (!element) return null;
  }
  return element;
}

// Validate the source-backed binding before authored JavaScript runs. The path
// is the authority for direct Canvas/SVG roots. Source-empty hosts additionally
// require their stable source identity to be unique, rather than asking the
// runtime DOM to guess a replacement target.
function frozenSourceBindingKeys(request) {
  let document;
  try {
    document = parseHtml(request.html);
  } catch {
    return null;
  }
  const root = staticHtmlElement(document);
  if (!root) return null;
  const elements = staticElements(root);
  const keys = new Set();
  request.candidates.forEach((candidate) => {
    const bound = staticChildAtPath(root, candidate.path);
    if (!bound || !staticMatchesBinding(bound, candidate)) return;
    if (candidate.kind !== "host") {
      keys.add(candidate.key);
      return;
    }
    const matches = elements.filter((element) => staticMatchesBinding(element, candidate));
    if (matches.length === 1 && matches[0] === bound) keys.add(candidate.key);
  });
  return keys;
}

/**
 * Validates the only renderer-to-owner request. It deliberately excludes a
 * project path, TargetRef, comment IDs, binary data, and arbitrary scripts.
 */
export function validateRuntimeSnapshotCaptureRequest(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !CAPTURE_REQUEST_KEYS.has(key))
  ) {
    throw new TypeError("Runtime snapshot capture request is invalid.");
  }
  if (value.contractVersion !== RUNTIME_VISUAL_CONTRACT_VERSION) {
    throw new TypeError("Runtime snapshot capture contract version is invalid.");
  }
  const captureSessionId = String(value.captureSessionId || "");
  const sourceSha = String(value.sourceSha256 || "").toLowerCase();
  const html = typeof value.html === "string" ? value.html : null;
  if (
    !isRuntimeVisualSessionIdentity(captureSessionId)
    || !isRuntimeVisualSourceSha256(sourceSha)
    || !html
    || Buffer.byteLength(html, "utf8") > RUNTIME_VISUAL_CONTRACT.pageBudget.htmlBytes
    || sourceSha256(html) !== sourceSha
  ) {
    throw new TypeError("Runtime snapshot capture source identity is invalid.");
  }
  if (value.side !== "before" && value.side !== "after") {
    throw new TypeError("Runtime snapshot capture side is invalid.");
  }
  if (
    !isRecord(value.viewport)
    || Object.keys(value.viewport).some((key) => key !== "width" && key !== "height")
  ) {
    throw new TypeError("Runtime snapshot capture viewport is invalid.");
  }
  const width = boundedInteger(value.viewport.width, RUNTIME_VISUAL_PAGE_BUDGET.viewport.minWidth, RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxWidth);
  const height = boundedInteger(value.viewport.height, RUNTIME_VISUAL_PAGE_BUDGET.viewport.minHeight, RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxHeight);
  if (width === null || height === null) {
    throw new TypeError("Runtime snapshot capture viewport is invalid.");
  }
  if (
    !Array.isArray(value.candidates)
    || value.candidates.length > RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit
  ) {
    throw new TypeError("Runtime snapshot capture candidates are invalid.");
  }
  const keys = new Set();
  const candidates = value.candidates.map((candidate) => normalizeCandidate(candidate, keys));
  if (candidates.some((candidate) => candidate === null)) {
    throw new TypeError("Runtime snapshot capture candidate identity is invalid.");
  }
  return Object.freeze({
    contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
    captureSessionId,
    sourceSha256: sourceSha,
    side: value.side,
    html,
    candidates: Object.freeze(candidates),
    viewport: Object.freeze({ width, height }),
  });
}

export function isolatedSnapshotRectScript(candidate) {
  return String.raw`(() => {
  "use strict";
  const __pagerootRuntimeSnapshotRects = true;
  const candidate = ${safeScriptValue(candidate)};
  const maxTextNodes = ${safeScriptValue(RUNTIME_VISUAL_PAGE_BUDGET.hostAtoms)};
  const maxRenderedTextBytes = ${safeScriptValue(RUNTIME_VISUAL_PAGE_BUDGET.renderedTextBytes)};
  const maxSurfacePixels = ${safeScriptValue(SURFACE_PIXEL_LIMIT)};
  const maxSurfaceMarkup = ${safeScriptValue(SURFACE_MARKUP_LIMIT)};
  const maxPresentationDepth = ${safeScriptValue(PRESENTATION_ANCESTOR_DEPTH)};
  const maxSurfaceDrawables = ${safeScriptValue(SURFACE_DRAWABLE_LIMIT)};
  const maxLayoutWidth = ${safeScriptValue(RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxWidth)};
  const maxLayoutHeight = ${safeScriptValue(RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxHeight)};
  const queryElements = Function.prototype.call.bind(Element.prototype.querySelectorAll);
  const getAttribute = Function.prototype.call.bind(Element.prototype.getAttribute);
  const getRect = Function.prototype.call.bind(Element.prototype.getBoundingClientRect);
  const scrollIntoView = Function.prototype.call.bind(Element.prototype.scrollIntoView);
  const getComputedStyle = Function.prototype.call.bind(window.getComputedStyle);
  const createTreeWalker = Function.prototype.call.bind(Document.prototype.createTreeWalker);
  // Bound in the isolated world, so the authored page cannot patch them: the
  // digest below reads the real drawing surface, not something the page can
  // describe to us.
  const getContext = Function.prototype.call.bind(HTMLCanvasElement.prototype.getContext);
  const readPixels = Function.prototype.call.bind(
    CanvasRenderingContext2D.prototype.getImageData,
  );
  const outerMarkup = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML").get;
  const nextTreeNode = Function.prototype.call.bind(TreeWalker.prototype.nextNode);
  const createRange = Function.prototype.call.bind(Document.prototype.createRange);
  const selectNodeContents = Function.prototype.call.bind(Range.prototype.selectNodeContents);
  const rangeClientRects = Function.prototype.call.bind(Range.prototype.getClientRects);
  const childAtPath = (path) => {
    let element = document.documentElement;
    for (const index of path) {
      element = element?.children?.[index] || null;
      if (!(element instanceof Element)) return null;
    }
    return element instanceof Element ? element : null;
  };
  const tagMatches = (element, tagName) => (
    element instanceof Element
    && String(element.tagName || "").toLowerCase() === String(tagName || "").toLowerCase()
  );
  const bindingMatches = (element, candidate) => (
    tagMatches(element, candidate.tagName)
    && candidate.identityAttributes.every(([name, value]) => getAttribute(element, name) === value)
  );
  // The host's own size, independent of where it sits. A chart taller or wider
  // than the capture viewport can still be compared through its drawing surface,
  // which lives in the chart's own coordinate space; only the window-pixel
  // fallback needs the host to fit. Measurement on authored pages showed this
  // is not a corner case: one page had eight charts none of which fitted, and
  // every one of them was permanently unverifiable for that reason alone.
  const measuredSize = (element) => {
    const rect = getRect(element);
    if (
      !Number.isFinite(rect.width)
      || !Number.isFinite(rect.height)
      || rect.width < 1
      || rect.height < 1
    ) return null;
    return {
      width: Math.min(Math.ceil(rect.width), maxLayoutWidth),
      height: Math.min(Math.ceil(rect.height), maxLayoutHeight),
    };
  };
  const usableRect = (element) => {
    const rect = getRect(element);
    if (
      !Number.isFinite(rect.x)
      || !Number.isFinite(rect.y)
      || !Number.isFinite(rect.width)
      || !Number.isFinite(rect.height)
      || rect.width < 1
      || rect.height < 1
      || rect.x < 0
      || rect.y < 0
      || rect.x + rect.width > window.innerWidth
      || rect.y + rect.height > window.innerHeight
    ) return null;
    // Crop on the nearest whole pixel instead of flooring the origin while
    // ceiling the size. That asymmetry offset the captured band from the host by
    // up to a full pixel, and because the offset follows the host's fractional
    // page position it differed between the two sides of one pair: an unchanged
    // chart was then sampled twice at different sub-pixel phases.
    const x = Math.min(Math.max(0, Math.round(rect.x)), window.innerWidth - 1);
    const y = Math.min(Math.max(0, Math.round(rect.y)), window.innerHeight - 1);
    return {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(rect.width), window.innerWidth - x)),
      height: Math.max(1, Math.min(Math.round(rect.height), window.innerHeight - y)),
    };
  };
  const alphaTokenIsVisible = (value) => {
    const token = String(value || "").trim();
    if (!token) return false;
    if (token.endsWith("%")) return Number.parseFloat(token.slice(0, -1)) > 0;
    return Number.parseFloat(token) > 0;
  };
  const filterHidesPaint = (value) => {
    const filter = String(value || "").trim().toLowerCase();
    if (!filter || filter === "none") return false;
    let cursor = 0;
    while (cursor < filter.length) {
      const offset = filter.slice(cursor).indexOf("opacity(");
      if (offset < 0) return false;
      const start = cursor + offset;
      const previous = start === 0 ? " " : filter[start - 1];
      const end = filter.indexOf(")", start + 8);
      if (end < 0) return false;
      if ((previous === " " || previous === "\t") && !alphaTokenIsVisible(filter.slice(start + 8, end))) {
        return true;
      }
      cursor = end + 1;
    }
    return false;
  };
  const maskMakesTextPaintUnverifiable = (style) => {
    const maskImages = [
      style.maskImage || style.getPropertyValue("mask-image"),
      style.webkitMaskImage || style.getPropertyValue("-webkit-mask-image"),
    ];
    // A CSS/SVG mask can make a subtree wholly transparent, but its general
    // image grammar cannot be reduced to a reliable text-paint predicate.
    // Keep the strict text layer for text whose paint can be proved; masked
    // text falls back to the existing raster layer rather than causing a
    // false marker from text with no captured pixels.
    return maskImages.some((value) => {
      const mask = String(value || "").trim().toLowerCase();
      return Boolean(mask && mask !== "none");
    });
  };
  const colorIsVisible = (value, fallback = "") => {
    const color = String(value || "").trim().toLowerCase();
    if (!color || color === "none" || color === "transparent") return false;
    // SVG paint servers are not colors. A referenced gradient/pattern can be
    // absent or fully transparent, so it cannot prove that this text has
    // pixels without inspecting another authored resource.
    if (color.startsWith("url(")) return false;
    if (color === "currentcolor") {
      const fallbackColor = String(fallback || "").trim().toLowerCase();
      return fallbackColor && fallbackColor !== "currentcolor"
        ? colorIsVisible(fallback)
        : false;
    }
    if (color.startsWith("#")) {
      const alpha = color.length === 5 ? color.slice(4) : color.length === 9 ? color.slice(7) : "";
      return alpha ? Number.parseInt(alpha, 16) > 0 : true;
    }
    const open = color.indexOf("(");
    const close = color.indexOf(")", open + 1);
    if (open < 1 || close < open) return true;
    const name = color.slice(0, open).trim();
    const argumentsText = color.slice(open + 1, close);
    const slash = argumentsText.lastIndexOf("/");
    if (slash >= 0) return alphaTokenIsVisible(argumentsText.slice(slash + 1));
    if (name === "rgba" || name === "hsla") {
      const comma = argumentsText.lastIndexOf(",");
      return comma >= 0 ? alphaTokenIsVisible(argumentsText.slice(comma + 1)) : false;
    }
    return true;
  };
  const textShadowIsVisible = (value, fallback) => {
    const shadow = String(value || "").trim();
    if (!shadow || shadow === "none") return false;
    const functions = ["rgba(", "rgb(", "hsla(", "hsl(", "color(", "oklab(", "oklch(", "lab(", "lch("];
    let cursor = 0;
    let foundColor = false;
    while (cursor < shadow.length) {
      let start = -1;
      for (const prefix of functions) {
        const candidateStart = shadow.toLowerCase().indexOf(prefix, cursor);
        if (candidateStart >= 0 && (start < 0 || candidateStart < start)) start = candidateStart;
      }
      if (start < 0) break;
      const end = shadow.indexOf(")", start + 1);
      if (end < 0) return false;
      foundColor = true;
      if (colorIsVisible(shadow.slice(start, end + 1), fallback)) return true;
      cursor = end + 1;
    }
    return foundColor ? false : colorIsVisible(fallback);
  };
  const backgroundImageHasVisibleColor = (value, fallback) => {
    const image = String(value || "").trim().toLowerCase();
    if (!image || image === "none") return false;
    // Computed gradient colors are serialized as color functions in Chromium.
    // Accept only a positively visible stop; external images and unknown image
    // grammars stay on the existing raster path.
    const functions = ["rgba(", "rgb(", "hsla(", "hsl(", "color(", "oklab(", "oklch(", "lab(", "lch("];
    let cursor = 0;
    while (cursor < image.length) {
      let start = -1;
      for (const prefix of functions) {
        const candidateStart = image.indexOf(prefix, cursor);
        if (candidateStart >= 0 && (start < 0 || candidateStart < start)) start = candidateStart;
      }
      if (start < 0) return false;
      const end = image.indexOf(")", start + 1);
      if (end < 0) return false;
      if (colorIsVisible(image.slice(start, end + 1), fallback)) return true;
      cursor = end + 1;
    }
    return false;
  };
  const backgroundTextPaintIsVisible = (style) => {
    const clips = [
      style.backgroundClip || style.getPropertyValue("background-clip"),
      style.webkitBackgroundClip || style.getPropertyValue("-webkit-background-clip"),
    ];
    if (!clips.some((value) => String(value || "").trim().toLowerCase().includes("text"))) {
      return false;
    }
    const backgroundColor = style.backgroundColor || style.getPropertyValue("background-color");
    if (colorIsVisible(backgroundColor, style.color)) return true;
    return backgroundImageHasVisibleColor(
      style.backgroundImage || style.getPropertyValue("background-image"),
      style.color,
    ) || backgroundImageHasVisibleColor(
      style.webkitBackgroundImage || style.getPropertyValue("-webkit-background-image"),
      style.color,
    );
  };
  const textPaintIsVisible = (element) => {
    const style = getComputedStyle(window, element);
    if (element.namespaceURI === "http://www.w3.org/2000/svg") {
      const strokeWidth = Number.parseFloat(style.strokeWidth || "0");
      const paintIsVisible = (color, opacity) => (
        Number.parseFloat(opacity || "1") > 0
        && colorIsVisible(color, style.color)
      );
      return paintIsVisible(style.fill, style.fillOpacity)
        || (strokeWidth > 0 && paintIsVisible(style.stroke, style.strokeOpacity));
    }
    const textFill = String(
      style.webkitTextFillColor || style.getPropertyValue("-webkit-text-fill-color") || "",
    ).trim();
    const fill = textFill && textFill.toLowerCase() !== "currentcolor"
      ? textFill
      : style.color;
    const strokeWidth = Number.parseFloat(style.webkitTextStrokeWidth || "0");
    return colorIsVisible(fill, style.color)
      || backgroundTextPaintIsVisible(style)
      || textShadowIsVisible(style.textShadow, style.color)
      || (
        strokeWidth > 0
        && colorIsVisible(style.webkitTextStrokeColor, style.color)
      );
  };
  const normalizedRect = (value) => {
    if (
      !value
      || !Number.isFinite(value.x)
      || !Number.isFinite(value.y)
      || !Number.isFinite(value.width)
      || !Number.isFinite(value.height)
    ) return null;
    const right = value.x + value.width;
    const bottom = value.y + value.height;
    return Number.isFinite(right) && Number.isFinite(bottom)
      ? { x: value.x, y: value.y, right, bottom }
      : null;
  };
  const rectContains = (outer, inner) => (
    outer
    && inner
    && inner.x >= outer.x
    && inner.y >= outer.y
    && inner.right <= outer.right
    && inner.bottom <= outer.bottom
  );
  const clipsOverflow = (value) => {
    const overflow = String(value || "visible").trim().toLowerCase();
    return overflow !== "" && overflow !== "visible";
  };
  const rectFitsOverflow = (rect, elementRect, style) => {
    const clipsX = clipsOverflow(style.overflowX || style.overflow);
    const clipsY = clipsOverflow(style.overflowY || style.overflow);
    return (!clipsX || (rect.x >= elementRect.x && rect.right <= elementRect.right))
      && (!clipsY || (rect.y >= elementRect.y && rect.bottom <= elementRect.bottom));
  };
  const numericClipEdge = (value, fallback) => {
    const token = String(value || "").trim().toLowerCase();
    if (!token || token === "auto") return fallback;
    const number = Number.parseFloat(token);
    return Number.isFinite(number) ? number : null;
  };
  const legacyClipRect = (elementRect, style) => {
    if (style.position !== "absolute" && style.position !== "fixed") return null;
    const value = String(style.clip || style.getPropertyValue("clip") || "").trim().toLowerCase();
    if (!value.startsWith("rect(") || !value.endsWith(")")) return null;
    const values = value.slice(5, -1).replaceAll(",", " ").split(" ").filter(Boolean);
    if (values.length !== 4) return null;
    const top = numericClipEdge(values[0], 0);
    const right = numericClipEdge(values[1], elementRect.right - elementRect.x);
    const bottom = numericClipEdge(values[2], elementRect.bottom - elementRect.y);
    const left = numericClipEdge(values[3], 0);
    if ([top, right, bottom, left].some((edge) => edge === null)) return null;
    return {
      x: elementRect.x + left,
      y: elementRect.y + top,
      right: elementRect.x + Math.max(left, right),
      bottom: elementRect.y + Math.max(top, bottom),
    };
  };
  const insetClipPathRect = (elementRect, style) => {
    const value = String(style.clipPath || style.getPropertyValue("clip-path") || "").trim().toLowerCase();
    if (!value.startsWith("inset(") || !value.endsWith(")")) return null;
    const contents = value.slice(6, -1);
    const roundIndex = contents.indexOf(" round ");
    const values = (roundIndex >= 0 ? contents.slice(0, roundIndex) : contents)
      .replaceAll(",", " ")
      .split(" ")
      .filter(Boolean);
    if (values.length < 1 || values.length > 4) return null;
    const parseInset = (token, size) => {
      const number = Number.parseFloat(token);
      if (!Number.isFinite(number)) return null;
      return String(token).trim().endsWith("%") ? (number * size) / 100 : number;
    };
    const [topValue, rightValue, bottomValue, leftValue] = values.length === 1
      ? [values[0], values[0], values[0], values[0]]
      : values.length === 2
        ? [values[0], values[1], values[0], values[1]]
        : values.length === 3
          ? [values[0], values[1], values[2], values[1]]
          : values;
    const top = parseInset(topValue, elementRect.bottom - elementRect.y);
    const right = parseInset(rightValue, elementRect.right - elementRect.x);
    const bottom = parseInset(bottomValue, elementRect.bottom - elementRect.y);
    const left = parseInset(leftValue, elementRect.right - elementRect.x);
    if ([top, right, bottom, left].some((edge) => edge === null)) return null;
    return {
      x: elementRect.x + left,
      y: elementRect.y + top,
      right: elementRect.right - right,
      bottom: elementRect.bottom - bottom,
    };
  };
  const rectIsVisibleThroughAncestors = (rect, textElement, host, hostRect) => {
    const textRect = normalizedRect(rect);
    if (!textRect || !rectContains(normalizedRect(hostRect), textRect)) return false;
    let element = textElement;
    while (element instanceof Element) {
      const style = getComputedStyle(window, element);
      const overflowX = clipsOverflow(style.overflowX || style.overflow);
      const overflowY = clipsOverflow(style.overflowY || style.overflow);
      const clip = String(style.clip || style.getPropertyValue("clip") || "").trim().toLowerCase();
      const clipPath = String(style.clipPath || style.getPropertyValue("clip-path") || "").trim().toLowerCase();
      const appliesLegacyClip = (style.position === "absolute" || style.position === "fixed")
        && clip
        && clip !== "auto";
      if (overflowX || overflowY || appliesLegacyClip || (clipPath && clipPath !== "none")) {
        const elementRect = normalizedRect(getRect(element));
        if (!elementRect || !rectFitsOverflow(textRect, elementRect, style)) return false;
        if (appliesLegacyClip) {
          const clipped = legacyClipRect(elementRect, style);
          if (!clipped || !rectContains(clipped, textRect)) return false;
        }
        if (clipPath && clipPath !== "none") {
          const inset = insetClipPathRect(elementRect, style);
          if (!inset || !rectContains(inset, textRect)) return false;
        }
      }
      // A partially clipped text node has no stable semantic subset to hash;
      // preserve the strict layer only for text that is fully painted.
      if (element === host) return true;
      element = element.parentElement;
    }
    return false;
  };
  const textNodeIsVisible = (node, host, hostRect) => {
    const textElement = node.parentElement;
    let element = textElement;
    while (element instanceof Element) {
      const style = getComputedStyle(window, element);
      const opacity = Number.parseFloat(style.opacity);
      if (
        style.display === "none"
        || style.contentVisibility === "hidden"
        || (Number.isFinite(opacity) && opacity <= 0)
        || filterHidesPaint(style.filter || style.getPropertyValue("filter"))
        || maskMakesTextPaintUnverifiable(style)
      ) return false;
      if (element === host) break;
      element = element.parentElement;
    }
    const textStyle = textElement instanceof Element
      ? getComputedStyle(window, textElement)
      : null;
    if (
      !(element instanceof Element)
      || !textStyle
      || textStyle.visibility === "hidden"
      || textStyle.visibility === "collapse"
      || !textPaintIsVisible(textElement)
    ) return false;
    const range = createRange(document);
    selectNodeContents(range, node);
    const textRects = Array.from(rangeClientRects(range)).filter((rect) => (
      Number.isFinite(rect.x)
      && Number.isFinite(rect.y)
      && Number.isFinite(rect.width)
      && Number.isFinite(rect.height)
      && rect.width > 0
      && rect.height > 0
    ));
    return textRects.length > 0
      && textRects.every((rect) => rectIsVisibleThroughAncestors(rect, textElement, host, hostRect));
  };
  const textSummaryChunk = (node, rawValue) => {
    const textElement = node.parentElement;
    if (!(textElement instanceof Element)) return null;
    const style = getComputedStyle(window, textElement);
    const transform = String(style.textTransform || style.getPropertyValue("text-transform") || "none")
      .trim()
      .toLowerCase();
    // CSS owns locale-aware and glyph-level text transforms. Without a browser
    // serialization of the final glyph text, transformed runs cannot prove a
    // stable source-string summary, so they use the existing raster layer.
    if (transform && transform !== "none") return null;
    const whiteSpace = String(style.whiteSpace || style.getPropertyValue("white-space") || "normal")
      .trim()
      .toLowerCase();
    const preservesAllWhitespace = whiteSpace === "pre"
      || whiteSpace === "pre-wrap"
      || whiteSpace === "break-spaces";
    const preservesSegmentBreaks = whiteSpace === "pre-line";
    const preservesWhitespace = preservesAllWhitespace || preservesSegmentBreaks;
    const value = preservesAllWhitespace
      ? rawValue
      : preservesSegmentBreaks
        ? rawValue.replace(/[ \t\f\r]+/gu, " ")
      : rawValue.replace(/\s+/gu, " ");
    return value ? { value, preservesWhitespace } : null;
  };
  const appendTextSummaryChunk = (chunks, chunk) => {
    const previous = chunks[chunks.length - 1];
    if (!chunk.preservesWhitespace && previous && !previous.preservesWhitespace) {
      const value = previous.value.endsWith(" ") && chunk.value.startsWith(" ")
        ? chunk.value.slice(1)
        : chunk.value;
      previous.value += value;
      return;
    }
    chunks.push({ ...chunk });
  };
  const trimCollapsedSummaryEdges = (chunks) => {
    while (chunks.length && !chunks[0].preservesWhitespace) {
      chunks[0].value = chunks[0].value.replace(/^ +/u, "");
      if (chunks[0].value) break;
      chunks.shift();
    }
    while (chunks.length && !chunks[chunks.length - 1].preservesWhitespace) {
      const last = chunks[chunks.length - 1];
      last.value = last.value.replace(/ +$/u, "");
      if (last.value) break;
      chunks.pop();
    }
  };
  const visibleRenderedText = (host, hostRect) => {
    try {
      const walker = createTreeWalker(document, host, 4);
      const chunks = [];
      const encoder = new TextEncoder();
      let textNodeCount = 0;
      let textBytes = 0;
      let node = nextTreeNode(walker);
      while (node) {
        textNodeCount += 1;
        if (textNodeCount > maxTextNodes) return null;
        const rawValue = String(node.nodeValue || "");
        if (rawValue.length > maxRenderedTextBytes) return null;
        const chunk = textSummaryChunk(node, rawValue);
        if (chunk && textNodeIsVisible(node, host, hostRect)) {
          textBytes += encoder.encode(chunk.value).byteLength;
          if (textBytes > maxRenderedTextBytes) return null;
          appendTextSummaryChunk(chunks, chunk);
        }
        node = nextTreeNode(walker);
      }
      trimCollapsedSummaryEdges(chunks);
      const summary = chunks.map((chunk) => chunk.value).join("");
      return encoder.encode(summary).byteLength <= maxRenderedTextBytes
        ? summary
        : null;
    } catch {
      return null;
    }
  };
  // Window pixels answer "what did this region of the page look like", which
  // is not the question. A chart moved half a device pixel by an unrelated
  // edit above it re-rasterizes its antialiasing across the whole surface and
  // reads as a confirmed change; measurement put that at 100% of hosts on
  // three real pages. A canvas bitmap and an SVG subtree are the chart's own
  // output in its own coordinate space, so neither moves when the host moves.
  //
  // The digest is a fold rather than a cryptographic hash: it runs over
  // megabytes inside the page process, and the owner re-hashes the compact
  // result. A cross-origin-tainted canvas throws instead of returning pixels,
  // and any failure yields "" so the caller falls back to the raster path
  // rather than claiming an unchanged surface it never read.
  const foldInto = (state, value) => {
    let hash = state;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  };
  const foldBytes = (state, bytes) => {
    let hash = state;
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  };
  const surfaceDigestOf = (targets) => {
    let hash = 2166136261;
    let readable = 0;
    for (const target of targets) {
      if (target.tagName === "CANVAS") {
        const width = target.width;
        const height = target.height;
        if (!width || !height || width * height > maxSurfacePixels) return "";
        const context = getContext(target, "2d");
        if (!context) return "";
        let image;
        try {
          image = readPixels(context, 0, 0, width, height);
        } catch {
          return "";
        }
        hash = foldInto(hash, "canvas:" + width + "x" + height + ";");
        hash = foldBytes(hash, image.data);
        readable += 1;
        continue;
      }
      const markup = outerMarkup.call(target);
      if (typeof markup !== "string" || markup.length > maxSurfaceMarkup) return "";
      hash = foldInto(hash, "svg:" + markup.replace(/\s+/gu, " ") + ";");
      // Markup carries geometry, not resolved paint. A stylesheet rule such as
      // "svg path { fill: ... }" recolours the whole chart without editing one
      // character of the subtree, and measurement showed that recolouring an
      // inline SVG went completely undetected while only the markup was read.
      const drawables = queryElements(target, "path,rect,circle,ellipse,polygon,polyline,line,text");
      if (drawables.length > maxSurfaceDrawables) return "";
      for (const drawable of drawables) {
        const style = getComputedStyle(window, drawable);
        hash = foldInto(
          hash,
          "paint:" + String(style.fill || "")
            + "|" + String(style.stroke || "")
            + "|" + String(style.strokeWidth || "")
            + "|" + String(style.fillOpacity || "")
            + "|" + String(style.strokeOpacity || "")
            + "|" + String(style.opacity || "") + ";",
        );
      }
      readable += 1;
    }
    return readable ? String(hash) : "";
  };

  // A drawing surface is not the whole appearance. CSS filter, opacity,
  // mix-blend-mode and friends repaint a chart at composite time without
  // touching one byte of its canvas, and an external stylesheet recolours an
  // inline SVG without touching its markup. Measurement caught exactly this:
  // inverting a host went 100% undetected on real pages once the surface
  // decided the verdict. Folding the resolved presentation values in restores
  // those changes as facts.
  //
  // Ancestor transform is deliberately excluded. A sticky or animated
  // ancestor resolves a scroll-dependent matrix, so folding it in would
  // reintroduce the position sensitivity this digest exists to remove; that
  // residue stays with the pixel path instead.
  const HOST_PRESENTATION = [
    "filter",
    "backdropFilter",
    "opacity",
    "mixBlendMode",
    "visibility",
    "clipPath",
    "maskImage",
    "transform",
    "backgroundColor",
    "backgroundImage",
    "boxShadow",
    "borderRadius",
    "outline",
  ];
  const ANCESTOR_PRESENTATION = [
    "filter",
    "backdropFilter",
    "opacity",
    "mixBlendMode",
    "visibility",
    "clipPath",
    "maskImage",
  ];
  const presentationDigestOf = (element, targets) => {
    let hash = 2166136261;
    const fold = (node, properties, label) => {
      const style = getComputedStyle(window, node);
      hash = foldInto(hash, label + ":");
      for (const property of properties) {
        hash = foldInto(hash, property + "=" + String(style[property] || "") + ";");
      }
    };
    try {
      fold(element, HOST_PRESENTATION, "host");
      // The canvas or svg is a descendant of the host, so a rule aimed at it
      // directly would otherwise slip between the host reading and the
      // surface reading.
      targets.forEach((target, index) => fold(target, HOST_PRESENTATION, "target" + index));
      let ancestor = element.parentElement;
      let depth = 0;
      while (ancestor && depth < maxPresentationDepth) {
        fold(ancestor, ANCESTOR_PRESENTATION, "ancestor" + depth);
        ancestor = ancestor.parentElement;
        depth += 1;
      }
    } catch {
      return "";
    }
    return String(hash);
  };
  const unavailable = () => ({
    status: "captured",
    snapshots: [{
      key: candidate.key,
      state: "unavailable",
      rect: null,
      renderedText: "",
      surfaceDigest: "",
      scrolled: false,
    }],
  });
  const host = childAtPath(candidate.path);
  if (!bindingMatches(host, candidate)) return unavailable();
  // capturePage samples the last composited frame, so the owner has to know
  // whether this probe moved the page: a rect measured after a scroll that the
  // compositor has not committed yet would be filled with pre-scroll pixels.
  const scrollBeforeX = window.scrollX;
  const scrollBeforeY = window.scrollY;
  try { scrollIntoView(host, { block: "center", inline: "nearest" }); } catch {
    return unavailable();
  }
  const scrolled = window.scrollX !== scrollBeforeX || window.scrollY !== scrollBeforeY;
  const hostRect = usableRect(host);
  const paintTargets = candidate.kind === "host"
    ? Array.from(queryElements(host, "canvas,svg"))
    : [host];
  const hostSize = measuredSize(host);
  const hasVisiblePaint = paintTargets.some((target) => measuredSize(target) !== null);
  const renderedText = hostSize && hasVisiblePaint
    ? visibleRenderedText(host, hostRect || { x: 0, y: 0, ...hostSize })
    : null;
  const surfaceDigest = hostSize && hasVisiblePaint
    ? (() => {
      const drawn = surfaceDigestOf(paintTargets);
      if (!drawn) return "";
      const presentation = presentationDigestOf(host, paintTargets);
      // Either half missing leaves the pair on the pixel path rather than
      // letting a partial reading claim an unchanged appearance.
      return presentation ? drawn + "." + presentation : "";
    })()
    : "";
  return {
    status: "captured",
    snapshots: [
      hostSize && hasVisiblePaint && renderedText !== null && (hostRect || surfaceDigest)
        ? {
          key: candidate.key,
          state: "captured",
          rect: hostRect,
          layout: hostSize,
          renderedText,
          surfaceDigest,
          scrolled,
        }
        : {
          key: candidate.key,
          state: "unavailable",
          rect: null,
          renderedText: "",
          surfaceDigest: "",
          scrolled,
        },
    ],
  };
})()`;
}

function normalizedViewportRect(value, request) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !RECT_KEYS.has(key))
  ) return null;
  const rect = {
    x: boundedInteger(value.x, 0, request.viewport.width - 1),
    y: boundedInteger(value.y, 0, request.viewport.height - 1),
    width: boundedInteger(value.width, 1, request.viewport.width),
    height: boundedInteger(value.height, 1, request.viewport.height),
  };
  if (
    Object.values(rect).some((number) => number === null)
    || rect.x + rect.width > request.viewport.width
    || rect.y + rect.height > request.viewport.height
  ) return null;
  return Object.freeze(rect);
}

function boundedLayoutValue(value, limit) {
  return Number.isSafeInteger(value) && value >= 1 && value <= limit ? value : null;
}

function normalizedLayoutSize(value) {
  if (!isRecord(value)) return undefined;
  const width = boundedLayoutValue(value.width, RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxWidth);
  const height = boundedLayoutValue(value.height, RUNTIME_VISUAL_PAGE_BUDGET.viewport.maxHeight);
  if (width === null || height === null) return undefined;
  return Object.freeze({ width, height });
}

function normalizedOwnerRects(value, request) {
  if (
    !isRecord(value)
    || value.status !== "captured"
    || !Array.isArray(value.snapshots)
  ) return null;
  if (value.snapshots.length !== request.candidates.length) return null;
  const expectedKeys = new Set(request.candidates.map((candidate) => candidate.key));
  const seen = new Set();
  const snapshots = [];
  for (const rawSnapshot of value.snapshots) {
    if (
      !isRecord(rawSnapshot)
      || Object.keys(rawSnapshot).some((key) => !OWNER_RECT_KEYS.has(key))
      || !validCandidateKey(rawSnapshot.key)
      || !expectedKeys.has(rawSnapshot.key)
      || seen.has(rawSnapshot.key)
      || (rawSnapshot.state !== "captured" && rawSnapshot.state !== "unavailable")
    ) return null;
    // A captured host without a capturable rect is expected: only the pixel
    // fallback needs one, so the rect is optional as long as the layout size and
    // a surface digest are present.
    const rect = rawSnapshot.state === "captured"
      ? (rawSnapshot.rect === null ? null : normalizedViewportRect(rawSnapshot.rect, request))
      : rawSnapshot.rect === null ? null : undefined;
    const layout = rawSnapshot.state === "captured"
      ? normalizedLayoutSize(rawSnapshot.layout)
      : rawSnapshot.layout === null ? null : undefined;
    const renderedText = rawSnapshot.state === "captured"
      ? normalizedString(rawSnapshot.renderedText, RUNTIME_VISUAL_PAGE_BUDGET.renderedTextBytes)
      : rawSnapshot.renderedText === "" ? "" : undefined;
    const surfaceDigest = typeof rawSnapshot.surfaceDigest === "string"
      && rawSnapshot.surfaceDigest.length <= SURFACE_DIGEST_LENGTH_LIMIT
      && /^[0-9]*(?:\.[0-9]+)?$/u.test(rawSnapshot.surfaceDigest)
      && (rawSnapshot.state === "captured" || rawSnapshot.surfaceDigest === "")
      ? rawSnapshot.surfaceDigest
      : undefined;
    if (
      rect === undefined
      || renderedText === undefined
      || renderedText === null
      || surfaceDigest === undefined
      || layout === undefined
      || typeof rawSnapshot.scrolled !== "boolean"
      || (rawSnapshot.state === "captured" && !layout)
      || (rawSnapshot.state === "captured" && !rect && !surfaceDigest)
      || (
        typeof renderedText === "string"
        && Buffer.byteLength(renderedText, "utf8") > RUNTIME_VISUAL_PAGE_BUDGET.renderedTextBytes
      )
    ) return null;
    seen.add(rawSnapshot.key);
    snapshots.push(Object.freeze({
      key: rawSnapshot.key,
      state: rawSnapshot.state,
      rect,
      layout,
      renderedText,
      surfaceDigest,
      scrolled: rawSnapshot.scrolled,
    }));
  }
  return Object.freeze({ snapshots: Object.freeze(snapshots) });
}

function unavailableSnapshot(key) {
  return Object.freeze({
    key,
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    byteLength: 0,
    pngBytes: new Uint8Array(),
    renderedTextSha256: "",
    surfaceSha256: "",
    stability: "unknown",
  });
}

function validatedPng(image) {
  if (!image || typeof image.isEmpty !== "function" || image.isEmpty()) return null;
  const png = image.toPNG?.();
  if (!(png instanceof Uint8Array) || png.byteLength < 24 || png.byteLength > RUNTIME_VISUAL_PAGE_BUDGET.pngBytes) {
    return null;
  }
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte)) {
    return null;
  }
  if (![73, 72, 68, 82].every((byte, index) => png[12 + index] === byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || Math.max(width, height) > RUNTIME_VISUAL_PAGE_BUDGET.pngDimension
    || width * height > RUNTIME_VISUAL_PAGE_BUDGET.canvasPixels
  ) return null;
  const pngBytes = new Uint8Array(png);
  return Object.freeze({
    pngSha256: pngSha256(pngBytes),
    width,
    height,
    byteLength: pngBytes.byteLength,
    pngBytes,
  });
}

function frozenScriptResponse(bytes) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function blockedRequestResponse() {
  return new Response("Blocked", {
    status: 403,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function configureIsolatedSession(session, expectedUrl, frozenScripts = null) {
  session?.setPermissionRequestHandler?.((_webContents, _permission, callback) => {
    callback(false);
  });
  session?.setPermissionCheckHandler?.(() => false);
  session?.on?.("will-download", (event) => {
    event.preventDefault();
  });
  // Frozen chart-library scripts are the only https surface, and only when a
  // store pinned bytes for this capture session during prewarm. The handler
  // never fetches: an unpinned URL is blocked, so the capture page still has
  // no live network.
  const frozenScriptBytes = (url) => (
    frozenScripts ? frozenScripts.resolve(url) : null
  );
  const canServeFrozenScripts = Boolean(
    frozenScripts && typeof session?.protocol?.handle === "function",
  );
  if (canServeFrozenScripts) {
    session.protocol.handle("https", (request) => {
      const bytes = frozenScriptBytes(request?.url);
      return bytes ? frozenScriptResponse(bytes) : blockedRequestResponse();
    });
  }
  session?.webRequest?.onBeforeRequest?.((details, callback) => {
    let allowed = false;
    try {
      const expected = new URL(expectedUrl);
      const requested = new URL(details.url);
      allowed = (
        requested.protocol === "pageroot-preview:"
        && requested.hostname === expected.hostname
      ) || (
        canServeFrozenScripts
        && requested.protocol === "https:"
        && frozenScriptBytes(details.url) !== null
      );
    } catch {
      allowed = false;
    }
    callback({ cancel: !allowed });
  });
}

function ownerExecutor(webContents, source) {
  if (typeof webContents?.executeJavaScriptInIsolatedWorld !== "function") {
    throw new Error("Runtime snapshot capture requires isolated-world evaluation.");
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    RUNTIME_SNAPSHOT_CAPTURE_WORLD_ID,
    [{ code: source, url: "pageroot-runtime-snapshot-owner.js" }],
    true,
    true,
  );
}

function waitForFirstOffscreenPaint(webContents) {
  if (typeof webContents?.once !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    webContents.once("paint", () => resolve());
  });
}

/**
 * Resolves once the offscreen compositor has produced a frame after the probe
 * scrolled the page, so `capturePage` cannot sample a pre-scroll frame.
 *
 * A measured census attributed every unchanged-chart false positive to exactly
 * this gap: the probe centred a host and the owner sampled the previous frame,
 * filling an otherwise correct rect with content offset by the scroll
 * distance. The bounded fallback keeps a page that never repaints from holding
 * the owner deadline hostage; a fallback expiry is not an error, only a
 * capture that stays as trustworthy as it was before this wait existed.
 */
function waitForScrolledOffscreenFrame(webContents, fallbackMs) {
  if (typeof webContents?.once !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      webContents.removeListener?.("paint", finish);
      resolve();
    };
    const timeoutId = setTimeout(finish, Math.max(1, fallbackMs));
    webContents.once("paint", finish);
  });
}

// The first paint precedes asynchronous chart rendering (library load,
// initialization and the roughly one-second entrance animation), so an
// immediate capture would sample a blank or half-drawn host. The settle wait
// stays subordinate to the owner deadline via withOwnerDeadline.
function waitForCaptureSettle(settleMs) {
  const duration = Math.max(0, Math.round(Number(settleMs)) || 0);
  if (!duration) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

async function settleOwnerCleanup(cleanup) {
  let timeoutId = null;
  const completed = Promise.resolve().then(cleanup).catch(() => undefined);
  const grace = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, OWNER_CLEANUP_GRACE_MS);
  });
  try {
    await Promise.race([completed, grace]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/**
 * One-use RuntimeSnapshotOwner. The authored page gets no Bridge, project
 * capability, comment data, or owner protocol; it can only affect a bounded
 * PNG presentation result that the trusted renderer may discard.
 */
export function createRuntimeSnapshotCaptureController({
  BrowserWindowClass,
  createSession,
  revokeSession,
  createIsolatedSession,
  releaseIsolatedSession = async () => {},
  frozenChartScripts = null,
  ownerDeadlineMs = RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
  captureSettleMs = RUNTIME_VISUAL_CONTRACT.captureSettleMs,
  randomToken = () => randomBytes(12).toString("hex"),
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Runtime snapshot capture requires BrowserWindow.");
  }
  if (typeof createSession !== "function" || typeof revokeSession !== "function") {
    throw new TypeError("Runtime snapshot capture requires preview session ownership.");
  }
  if (typeof createIsolatedSession !== "function") {
    throw new TypeError("Runtime snapshot capture requires an isolated session.");
  }
  if (typeof releaseIsolatedSession !== "function") {
    throw new TypeError("Runtime snapshot capture requires isolated session cleanup.");
  }
  const deadlineMs = Math.max(1, Math.min(
    RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
    Math.round(Number(ownerDeadlineMs)) || RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
  ));
  const settleMs = Math.max(0, Math.min(
    RUNTIME_VISUAL_CONTRACT.captureSettleMs,
    Math.round(Number(captureSettleMs)) || 0,
  ));
  const activeCaptures = new Map();

  const capture = async (rawRequest) => {
    let request;
    try {
      request = validateRuntimeSnapshotCaptureRequest(rawRequest);
    } catch {
      return result("failed", "invalid-request");
    }
    const frozenBindingKeys = frozenSourceBindingKeys(request);
    if (!frozenBindingKeys) {
      return result("failed", "frozen-source-unavailable");
    }
    const captureCandidates = request.candidates.filter((candidate) => (
      frozenBindingKeys.has(candidate.key)
    ));
    if (!captureCandidates.length) {
      return captureResult(
        request,
        request.candidates.map((candidate) => unavailableSnapshot(candidate.key)),
      );
    }
    const operationKey = `${request.captureSessionId}:${request.side}`;
    activeCaptures.get(operationKey)?.cancel("superseded");

    // Prewarm runs before the owner deadline starts and is bounded by its own
    // budget. Freezing happens per capture session, so the before and after
    // sides always observe the same script bytes or the same absence.
    const sessionFrozenScripts = frozenChartScripts
      ? {
        resolve: (url) => frozenChartScripts.resolve(request.captureSessionId, url),
      }
      : null;
    if (frozenChartScripts) {
      try {
        await frozenChartScripts.prewarm({
          captureSessionId: request.captureSessionId,
          html: request.html,
        });
      } catch {
        // A failed prewarm only leaves scripts unpinned; capture proceeds and
        // the affected hosts stay unavailable, exactly like today.
      }
    }

    let captureWindow = null;
    let previewSession = null;
    let isolatedSession = null;
    let cancellationReason = null;
    let rejectCancelled = null;
    const cancelled = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const operation = {
      cancel: (reason = "cancelled") => {
        if (cancellationReason) return;
        cancellationReason = reason;
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
        rejectCancelled?.(new CaptureCancelledError());
      },
    };
    activeCaptures.set(operationKey, operation);
    const deadlineAt = Date.now() + deadlineMs;
    const withOwnerDeadline = async (promise) => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        operation.cancel("timed-out");
        throw new CaptureTimedOutError();
      }
      let timeoutId = null;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          operation.cancel("timed-out");
          reject(new CaptureTimedOutError());
        }, remaining);
      });
      try {
        return await Promise.race([promise, cancelled, timeout]);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
    };

    try {
      previewSession = await withOwnerDeadline(createSession({
        html: request.html,
        bootstrapJavaScript: "",
      }));
      if (!previewSession?.sessionId || !previewSession?.url) {
        return result("failed", "invalid-preview-session");
      }
      const partition = `${RUNTIME_SNAPSHOT_CAPTURE_PARTITION_PREFIX}${randomToken()}`;
      isolatedSession = await withOwnerDeadline(createIsolatedSession(partition));
      if (!isolatedSession || typeof isolatedSession !== "object") {
        return result("failed", "invalid-isolated-session");
      }
      configureIsolatedSession(isolatedSession, previewSession.url, sessionFrozenScripts);
      captureWindow = new BrowserWindowClass({
        show: false,
        frame: false,
        useContentSize: true,
        width: request.viewport.width,
        height: request.viewport.height,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          partition,
          session: isolatedSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          offscreen: true,
          backgroundThrottling: false,
        },
      });
      captureWindow.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
      captureWindow.webContents.on?.("will-attach-webview", (event) => {
        event.preventDefault();
      });
      captureWindow.webContents.on?.("will-navigate", (event, url) => {
        if (url !== previewSession.url) event.preventDefault();
      });
      const firstPaint = waitForFirstOffscreenPaint(captureWindow.webContents);
      await withOwnerDeadline(captureWindow.loadURL(previewSession.url));
      await withOwnerDeadline(firstPaint);
      await withOwnerDeadline(waitForCaptureSettle(settleMs));
      if (cancellationReason || captureWindow.isDestroyed()) throw new CaptureCancelledError();

      let capturedPixels = 0;
      let capturedBytes = 0;
      let stabilityBudgetMs = CAPTURE_STABILITY_BUDGET_MS;
      const snapshots = [];
      for (const candidate of request.candidates) {
        if (!frozenBindingKeys.has(candidate.key)) {
          snapshots.push(unavailableSnapshot(candidate.key));
          continue;
        }
        try {
          const remainingPixels = RUNTIME_VISUAL_PAGE_BUDGET.canvasPixels - capturedPixels;
          const remainingBytes = RUNTIME_VISUAL_PAGE_BUDGET.aggregatePngBytes - capturedBytes;
          if (remainingPixels < 1 || remainingBytes < 1) {
            snapshots.push(unavailableSnapshot(candidate.key));
            continue;
          }
          const ownerRequest = Object.freeze({
            ...request,
            candidates: Object.freeze([candidate]),
          });
          // One frame taken a fixed time after first paint is not evidence: a
          // chart library that finishes drawing on either side of that instant
          // yields two rasters of the same unchanged chart. Accept a candidate
          // only once two consecutive frames of the same host agree, and fail
          // closed to the static result when it never settles.
          let accepted = false;
          let previous = null;
          let latest = null;
          let comparedFrames = 0;
          let previousDigest = null;
          let latestSurfaceOnly = null;
          const pushSurfaceOnlySnapshot = (ownerSnapshot, stability) => {
            snapshots.push(Object.freeze({
              key: candidate.key,
              state: "captured",
              pngSha256: "",
              width: 0,
              height: 0,
              byteLength: 0,
              pngBytes: new Uint8Array(),
              layoutWidth: ownerSnapshot.layout.width,
              layoutHeight: ownerSnapshot.layout.height,
              renderedTextSha256: renderedTextSha256(ownerSnapshot.renderedText),
              surfaceSha256: renderedTextSha256(`surface:${ownerSnapshot.surfaceDigest}`),
              stability,
            }));
          };
          const pushSnapshot = ({ png, rect, ownerSnapshot }, stability) => {
            capturedPixels += png.width * png.height;
            capturedBytes += png.byteLength;
            snapshots.push(Object.freeze({
              key: candidate.key,
              state: "captured",
              ...png,
              layoutWidth: ownerSnapshot.layout.width,
              layoutHeight: ownerSnapshot.layout.height,
              renderedTextSha256: renderedTextSha256(ownerSnapshot.renderedText),
              // A digest the page could not produce stays empty rather than
              // hashing "" into something that looks like evidence.
              surfaceSha256: ownerSnapshot.surfaceDigest
                ? renderedTextSha256(`surface:${ownerSnapshot.surfaceDigest}`)
                : "",
              stability,
            }));
          };
          for (let attempt = 0; attempt < CAPTURE_STABILITY_ATTEMPTS; attempt += 1) {
            if (attempt > 0) {
              if (stabilityBudgetMs < CAPTURE_STABILITY_FRAME_FALLBACK_MS) break;
              const spentAt = Date.now();
              await withOwnerDeadline(waitForScrolledOffscreenFrame(
                captureWindow.webContents,
                CAPTURE_STABILITY_FRAME_FALLBACK_MS,
              ));
              stabilityBudgetMs -= Math.max(1, Date.now() - spentAt);
            }
            const ownerRects = normalizedOwnerRects(await withOwnerDeadline(ownerExecutor(
              captureWindow.webContents,
              isolatedSnapshotRectScript(candidate),
            )), ownerRequest);
            const ownerSnapshot = ownerRects?.snapshots[0];
            if (!ownerSnapshot || ownerSnapshot.state !== "captured") break;
            if (!ownerSnapshot.rect) {
              // Nothing to crop, so there are no window pixels to settle. The
              // drawing surface still answers the comparison, and it can also
              // answer whether the host is still moving: reading the digest
              // twice costs no capture. Without this a chart that repaints
              // without pause reported a confirmed change on two byte-identical
              // pages, which is exactly the failure the stability fact exists to
              // prevent.
              if (previousDigest === null) {
                previousDigest = ownerSnapshot.surfaceDigest;
                latestSurfaceOnly = ownerSnapshot;
                continue;
              }
              pushSurfaceOnlySnapshot(
                ownerSnapshot,
                previousDigest === ownerSnapshot.surfaceDigest
                  ? CAPTURE_SETTLED
                  : CAPTURE_MOVING,
              );
              accepted = true;
              break;
            }
            if (ownerSnapshot.rect.width * ownerSnapshot.rect.height > remainingPixels) break;
            if (attempt === 0 && ownerSnapshot.scrolled) {
              await withOwnerDeadline(waitForScrolledOffscreenFrame(
                captureWindow.webContents,
                SCROLLED_FRAME_FALLBACK_MS,
              ));
            }
            const image = await withOwnerDeadline(captureWindow.capturePage(ownerSnapshot.rect, {
              stayHidden: true,
            }));
            const png = validatedPng(image);
            if (
              !png
              || png.width * png.height > remainingPixels
              || png.byteLength > remainingBytes
            ) break;
            const settled = previous
              && previous.png.pngSha256 === png.pngSha256
              && previous.rect.width === ownerSnapshot.rect.width
              && previous.rect.height === ownerSnapshot.rect.height;
            latest = { png, rect: ownerSnapshot.rect, ownerSnapshot };
            if (settled) {
              pushSnapshot(latest, CAPTURE_SETTLED);
              accepted = true;
              break;
            }
            comparedFrames = previous ? comparedFrames + 1 : comparedFrames;
            previous = { png, rect: ownerSnapshot.rect };
          }
          // A host that never hands back two identical frames is still a host
          // the reviewer asked about. Dropping it turns a live chart into a
          // silent gap, which measurement showed costs whole pages: a page of
          // twelve continuously animating charts reported nothing at all, and
          // every "no false positive" reading on it was empty. Keep the last
          // frame and record that it never settled; the comparison then refuses
          // to reach a pixel verdict on it while dimensions, visible text and
          // the drawing-surface digest still decide normally, none of which
          // flickers with animation.
          if (!accepted) {
            if (latestSurfaceOnly) {
              // The budget ran out before a second digest read, so whether this
              // host is moving was never established.
              pushSurfaceOnlySnapshot(latestSurfaceOnly, CAPTURE_STABILITY_UNKNOWN);
            } else if (latest) {
              pushSnapshot(
                latest,
                comparedFrames > 0 ? CAPTURE_MOVING : CAPTURE_STABILITY_UNKNOWN,
              );
            } else snapshots.push(unavailableSnapshot(candidate.key));
          }
        } catch (error) {
          if (error instanceof CaptureTimedOutError || error instanceof CaptureCancelledError) {
            throw error;
          }
          snapshots.push(unavailableSnapshot(candidate.key));
        }
      }
      return captureResult(request, snapshots);
    } catch (error) {
      if (error instanceof CaptureTimedOutError || cancellationReason === "timed-out") {
        return result("timed-out", "owner-deadline");
      }
      if (error instanceof CaptureCancelledError || cancellationReason) {
        return result("cancelled", cancellationReason || "cancelled");
      }
      return result("failed", "capture-failed");
    } finally {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
      await Promise.all([
        isolatedSession
          ? settleOwnerCleanup(() => releaseIsolatedSession(isolatedSession))
          : undefined,
        previewSession?.sessionId
          ? settleOwnerCleanup(() => revokeSession(previewSession.sessionId))
          : undefined,
      ]);
      if (activeCaptures.get(operationKey) === operation) activeCaptures.delete(operationKey);
    }
  };

  return Object.freeze({
    capture,
    dispose: () => {
      activeCaptures.forEach((operation) => operation.cancel("cancelled"));
      activeCaptures.clear();
    },
  });
}
