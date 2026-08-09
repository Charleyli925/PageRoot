import { createHash, randomBytes } from "node:crypto";
import { parse as parseHtml } from "parse5";

import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
  isRuntimeVisualSessionIdentity,
  isRuntimeVisualSourceSha256,
} from "../app/domain/runtime-visual-contract.js";

const REVIEW_CAPTURE_WORLD_ID = 91_117;
const REVIEW_CAPTURE_PARTITION_PREFIX = "pageroot-review-runtime-";
const REVIEW_CAPTURE_SOURCE_BOX_ATTRIBUTES = Object.freeze([
  "class",
  "height",
  "hidden",
  "style",
  "width",
]);
const MAX_VIEWPORT_WIDTH = 4_096;
const MAX_VIEWPORT_HEIGHT = 2_400;
const MIN_VIEWPORT_WIDTH = 320;
const MIN_VIEWPORT_HEIGHT = 320;
const MAX_PATH_DEPTH = 256;
const MAX_IDENTITY_VALUE_LENGTH = 2_048;
const MAX_SOURCE_BOX_SIGNATURE_LENGTH = 4_096;
const MAX_PNG_BYTES = 2_000_000;
const MAX_PNG_DIMENSION = 4_096;
const MAX_DOCUMENT_COORDINATE = 10_000_000;
const MAX_DOCUMENT_DIMENSION = 1_000_000;
const OWNER_CLEANUP_GRACE_MS = 250;
const DIGEST_PATTERN = /^[a-f0-9]{32}$/u;
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
  "sourceBoxSignature",
  "identityAttributes",
  "identityText",
]);
const FACT_KEYS = new Set([
  "key",
  "state",
  "contentDigest",
  "paintDigest",
  "geometryDigest",
  "vectorDigest",
  "contentAtoms",
  "paintAtoms",
  "geometryAtoms",
  "vectorAtoms",
  "rect",
]);
const RECT_KEYS = new Set(["x", "y", "width", "height"]);

class CaptureCancelledError extends Error {
  constructor() {
    super("Review runtime capture was cancelled.");
  }
}

class CaptureTimedOutError extends Error {
  constructor() {
    super("Review runtime capture timed out.");
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

function snapshotDigest(value) {
  return createHash("sha256").update(value).digest("hex");
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
    && /^[A-Za-z_:][A-Za-z0-9:_.-]{0,127}$/u.test(value);
}

function validCandidateKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function validTagName(value) {
  // HTML exposes upper-case tag names while SVG/XML namespaces preserve case.
  // The frozen owner binding compares the exact string again in the isolated
  // document, so accepting either form does not weaken its identity check.
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9:-]{0,63}$/u.test(value);
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
  const sourceBoxSignature = normalizedString(
    value.sourceBoxSignature,
    MAX_SOURCE_BOX_SIGNATURE_LENGTH,
  );
  const identityAttributes = normalizeIdentityAttributes(value.identityAttributes);
  const identityText = value.identityText === undefined
    ? undefined
    : normalizedString(value.identityText, 1_024);
  if (
    !key
    || keys.has(key)
    || !tagName
    || !sourceBoxSignature
    || !identityAttributes
    || (value.identityText !== undefined && identityText === null)
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
    sourceBoxSignature,
    identityAttributes,
    ...(identityText ? { identityText } : {}),
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

function staticTextContent(node) {
  const ownValue = typeof node?.value === "string" ? node.value : "";
  const children = (node?.childNodes || []).map(staticTextContent).join("");
  const content = node?.content ? staticTextContent(node.content) : "";
  return `${ownValue}${children}${content}`;
}

function staticSourceBoxSignature(element) {
  return JSON.stringify(REVIEW_CAPTURE_SOURCE_BOX_ATTRIBUTES.map((name) => [
    name,
    staticAttribute(element, name),
  ]));
}

function staticMatchesBinding(element, candidate) {
  if (!staticTagMatches(element, candidate.tagName)) return false;
  if (staticSourceBoxSignature(element) !== candidate.sourceBoxSignature) return false;
  if (candidate.identityAttributes.some(([name, value]) => (
    staticAttribute(element, name) !== value
  ))) return false;
  return !candidate.identityText
    || staticTextContent(element).replace(/\s+/gu, " ").trim() === candidate.identityText;
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

// Validate the immutable source binding before any authored script is allowed
// to run. At runtime, style/size attributes may legitimately change, so the
// isolated world rechecks the same path and identity attributes rather than
// treating the initial visual box as a post-script invariant.
function requestHasFrozenSourceBindings(request) {
  let document;
  try {
    document = parseHtml(request.html);
  } catch {
    return false;
  }
  const root = staticHtmlElement(document);
  if (!root) return false;
  const elements = staticElements(root);
  return request.candidates.every((candidate) => {
    const bound = staticChildAtPath(root, candidate.path);
    const matches = elements.filter((element) => staticMatchesBinding(element, candidate));
    return Boolean(
      bound
      && staticMatchesBinding(bound, candidate)
      && matches.length === 1
      && matches[0] === bound,
    );
  });
}

/**
 * Validates the only renderer-to-owner request. It deliberately excludes a
 * project path, TargetRef, comment IDs, binary data, and arbitrary scripts.
 */
export function validateReviewRuntimeCaptureRequest(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !CAPTURE_REQUEST_KEYS.has(key))
  ) {
    throw new TypeError("Review runtime capture request is invalid.");
  }
  if (value.contractVersion !== RUNTIME_VISUAL_CONTRACT_VERSION) {
    throw new TypeError("Review runtime capture contract version is invalid.");
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
    throw new TypeError("Review runtime capture source identity is invalid.");
  }
  if (value.side !== "before" && value.side !== "after") {
    throw new TypeError("Review runtime capture side is invalid.");
  }
  if (
    !isRecord(value.viewport)
    || Object.keys(value.viewport).some((key) => key !== "width" && key !== "height")
  ) {
    throw new TypeError("Review runtime capture viewport is invalid.");
  }
  const width = boundedInteger(
    value.viewport.width,
    MIN_VIEWPORT_WIDTH,
    MAX_VIEWPORT_WIDTH,
  );
  const height = boundedInteger(
    value.viewport.height,
    MIN_VIEWPORT_HEIGHT,
    MAX_VIEWPORT_HEIGHT,
  );
  if (width === null || height === null) {
    throw new TypeError("Review runtime capture viewport is invalid.");
  }
  if (
    !Array.isArray(value.candidates)
    || value.candidates.length > RUNTIME_VISUAL_CONTRACT.candidateLimit
  ) {
    throw new TypeError("Review runtime capture candidates are invalid.");
  }
  const keys = new Set();
  const candidates = value.candidates.map((candidate) => normalizeCandidate(candidate, keys));
  if (candidates.some((candidate) => candidate === null)) {
    throw new TypeError("Review runtime capture candidate identity is invalid.");
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

function isolatedFactsScript(candidates) {
  return String.raw`(() => {
  "use strict";
  const __pagerootReviewRuntimeCaptureFacts = true;
  const candidates = ${safeScriptValue(candidates)};
  const queryDocument = Function.prototype.call.bind(Document.prototype.querySelectorAll);
  const queryElements = Function.prototype.call.bind(Element.prototype.querySelectorAll);
  const getAttribute = Function.prototype.call.bind(Element.prototype.getAttribute);
  const textContent = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")?.get;
  const computedStyle = getComputedStyle.bind(window);
  const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim().slice(0, 200000);
  const digest = (value) => {
    const text = String(value || "");
    let a = 0x811c9dc5;
    let b = 0x01000193;
    let c = 0x9e3779b9;
    let d = 0x85ebca6b;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      a = Math.imul(a ^ code, 0x01000193) >>> 0;
      b = Math.imul(b + code + (a >>> 16), 0x85ebca6b) >>> 0;
      c = Math.imul(c ^ (code + b), 0xc2b2ae35) >>> 0;
      d = Math.imul(d + (code ^ c), 0x27d4eb2f) >>> 0;
    }
    return [a, b, c, d].map((value) => value.toString(16).padStart(8, "0")).join("");
  };
  const childAtPath = (path) => {
    let element = document.documentElement;
    for (const index of path) {
      element = element?.children?.[index] || null;
      if (!(element instanceof Element)) return null;
    }
    return element instanceof Element ? element : null;
  };
  const matchesBinding = (element, candidate) => {
    if (!(element instanceof Element) || element.tagName !== candidate.tagName) return false;
    for (const [name, value] of candidate.identityAttributes) {
      if (getAttribute(element, name) !== value) return false;
    }
    return !candidate.identityText
      || normalizeText(textContent?.call(element) || "") === candidate.identityText;
  };
  const allElements = Array.from(queryDocument(document, "*"));
  const facts = [];
  for (const candidate of candidates) {
    const bound = childAtPath(candidate.path);
    const matches = allElements.filter((element) => matchesBinding(element, candidate));
    if (!bound || !matchesBinding(bound, candidate) || matches.length !== 1 || matches[0] !== bound) {
      return { status: "unmapped", facts: [] };
    }
    const rect = bound.getBoundingClientRect();
    const pageX = window.scrollX + rect.x;
    const pageY = window.scrollY + rect.y;
    if (
      !Number.isFinite(pageX)
      || !Number.isFinite(pageY)
      || !Number.isFinite(rect.width)
      || !Number.isFinite(rect.height)
      || rect.width < 1
      || rect.height < 1
    ) {
      facts.push({
        key: candidate.key,
        state: "unavailable",
        contentDigest: "",
        paintDigest: "",
        geometryDigest: "",
        vectorDigest: "",
        contentAtoms: 0,
        paintAtoms: 0,
        geometryAtoms: 0,
        vectorAtoms: 0,
        rect: null,
      });
      continue;
    }
    const style = computedStyle(bound);
    const text = normalizeText(textContent?.call(bound) || "");
    const paint = [
      style.backgroundColor,
      style.borderTopColor,
      style.borderRightColor,
      style.borderBottomColor,
      style.borderLeftColor,
      style.color,
      style.fill,
      style.stroke,
      style.opacity,
      style.visibility,
      style.display,
      style.transform,
    ].join("|");
    const vectorCount = Math.min(
      4096,
      queryElements(bound, "svg, path, rect, circle, ellipse, line, polyline, polygon").length,
    );
    const geometry = [pageX, pageY, rect.width, rect.height]
      .map((number) => Math.round(number * 100) / 100)
      .join("|");
    facts.push({
      key: candidate.key,
      state: "stable",
      contentDigest: text ? digest(text) : "",
      paintDigest: digest(paint),
      geometryDigest: digest(geometry),
      vectorDigest: vectorCount ? digest(String(vectorCount)) : "",
      contentAtoms: text ? 1 : 0,
      paintAtoms: 1,
      geometryAtoms: 4,
      vectorAtoms: vectorCount ? 1 : 0,
      rect: {
        x: Math.floor(pageX),
        y: Math.floor(pageY),
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
      },
    });
  }
  return { status: "captured", facts };
})()`;
}

function isolatedViewportRectScript(candidate) {
  return String.raw`(() => {
  "use strict";
  const candidate = ${safeScriptValue(candidate)};
  const queryAll = Function.prototype.call.bind(Document.prototype.querySelectorAll);
  const getAttribute = Function.prototype.call.bind(Element.prototype.getAttribute);
  const textContent = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")?.get;
  const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim().slice(0, 200000);
  const childAtPath = (path) => {
    let element = document.documentElement;
    for (const index of path) {
      element = element?.children?.[index] || null;
      if (!(element instanceof Element)) return null;
    }
    return element instanceof Element ? element : null;
  };
  const matchesBinding = (element) => {
    if (!(element instanceof Element) || element.tagName !== candidate.tagName) return false;
    for (const [name, value] of candidate.identityAttributes) {
      if (getAttribute(element, name) !== value) return false;
    }
    return !candidate.identityText
      || normalizeText(textContent?.call(element) || "") === candidate.identityText;
  };
  const bound = childAtPath(candidate.path);
  const matches = Array.from(queryAll(document, "*")).filter(matchesBinding);
  if (!bound || !matchesBinding(bound) || matches.length !== 1 || matches[0] !== bound) {
    return null;
  }
  const initialRect = bound.getBoundingClientRect();
  if (
    !Number.isFinite(initialRect.x)
    || !Number.isFinite(initialRect.y)
    || !Number.isFinite(initialRect.width)
    || !Number.isFinite(initialRect.height)
    || initialRect.width < 1
    || initialRect.height < 1
  ) return null;
  try {
    if (typeof bound.scrollIntoView !== "function") return null;
    bound.scrollIntoView({ block: "center", inline: "nearest" });
  } catch { return null; }
  const rect = bound.getBoundingClientRect();
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
  return {
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  };
})()`;
}

function normalizedFacts(value, request) {
  if (
    !isRecord(value)
    || (value.status !== "captured" && value.status !== "unmapped")
    || !Array.isArray(value.facts)
  ) return null;
  if (value.status === "unmapped") return Object.freeze({ unmapped: true, facts: [] });
  if (value.facts.length !== request.candidates.length) return null;
  const expectedKeys = new Set(request.candidates.map((candidate) => candidate.key));
  const seen = new Set();
  const facts = [];
  for (const fact of value.facts) {
    if (
      !isRecord(fact)
      || Object.keys(fact).some((key) => !FACT_KEYS.has(key))
      || !validCandidateKey(fact.key)
      || !expectedKeys.has(fact.key)
      || seen.has(fact.key)
      || (fact.state !== "stable" && fact.state !== "unavailable")
    ) return null;
    const contentAtoms = boundedInteger(fact.contentAtoms, 0, RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms);
    const paintAtoms = boundedInteger(fact.paintAtoms, 0, RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms);
    const geometryAtoms = boundedInteger(fact.geometryAtoms, 0, RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms);
    const vectorAtoms = boundedInteger(fact.vectorAtoms, 0, RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms);
    const digests = [
      fact.contentDigest,
      fact.paintDigest,
      fact.geometryDigest,
      fact.vectorDigest,
    ];
    if (
      contentAtoms === null
      || paintAtoms === null
      || geometryAtoms === null
      || vectorAtoms === null
      || !digests.every((digest) => typeof digest === "string" && (!digest || DIGEST_PATTERN.test(digest)))
    ) return null;
    if (fact.state === "unavailable") {
      if (
        contentAtoms !== 0
        || paintAtoms !== 0
        || geometryAtoms !== 0
        || vectorAtoms !== 0
        || digests.some(Boolean)
        || fact.rect !== null
      ) return null;
      seen.add(fact.key);
      facts.push(Object.freeze({
        key: fact.key,
        state: "unavailable",
        contentDigest: "",
        paintDigest: "",
        geometryDigest: "",
        vectorDigest: "",
        contentAtoms: 0,
        paintAtoms: 0,
        geometryAtoms: 0,
        vectorAtoms: 0,
        rect: null,
      }));
      continue;
    }
    if (
      !isRecord(fact.rect)
      || Object.keys(fact.rect).some((key) => !RECT_KEYS.has(key))
    ) return null;
    const rect = {
      x: boundedInteger(
        fact.rect.x,
        -MAX_DOCUMENT_COORDINATE,
        MAX_DOCUMENT_COORDINATE,
      ),
      y: boundedInteger(
        fact.rect.y,
        -MAX_DOCUMENT_COORDINATE,
        MAX_DOCUMENT_COORDINATE,
      ),
      width: boundedInteger(fact.rect.width, 1, MAX_DOCUMENT_DIMENSION),
      height: boundedInteger(fact.rect.height, 1, MAX_DOCUMENT_DIMENSION),
    };
    if (Object.values(rect).some((number) => number === null)) return null;
    seen.add(fact.key);
    facts.push(Object.freeze({
      key: fact.key,
      state: "stable",
      contentDigest: fact.contentDigest,
      paintDigest: fact.paintDigest,
      geometryDigest: fact.geometryDigest,
      vectorDigest: fact.vectorDigest,
      contentAtoms,
      paintAtoms,
      geometryAtoms,
      vectorAtoms,
      rect: Object.freeze(rect),
    }));
  }
  return Object.freeze({ unmapped: false, facts: Object.freeze(facts) });
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

function sameFact(fact, other) {
  return Boolean(other)
    && fact.key === other.key
    && fact.state === other.state
    && fact.contentDigest === other.contentDigest
    && fact.paintDigest === other.paintDigest
    && fact.geometryDigest === other.geometryDigest
    && fact.vectorDigest === other.vectorDigest
    && fact.contentAtoms === other.contentAtoms
    && fact.paintAtoms === other.paintAtoms
    && fact.geometryAtoms === other.geometryAtoms
    && fact.vectorAtoms === other.vectorAtoms
    && (
      (fact.rect === null && other.rect === null)
      || (
        fact.rect !== null
        && other.rect !== null
        && fact.rect.x === other.rect.x
        && fact.rect.y === other.rect.y
        && fact.rect.width === other.rect.width
        && fact.rect.height === other.rect.height
      )
    );
}

function validatedPng(image) {
  if (!image || typeof image.isEmpty !== "function" || image.isEmpty()) return null;
  const png = image.toPNG?.();
  if (!(png instanceof Uint8Array) || png.byteLength < 24 || png.byteLength > MAX_PNG_BYTES) {
    return null;
  }
  if (![
    137, 80, 78, 71, 13, 10, 26, 10,
  ].every((byte, index) => png[index] === byte)) return null;
  if (![73, 72, 68, 82].every((byte, index) => png[12 + index] === byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || width > MAX_PNG_DIMENSION
    || height > MAX_PNG_DIMENSION
    || width * height > RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels
  ) return null;
  return Object.freeze({
    digest: snapshotDigest(png),
    pixels: width * height,
    bytes: png.byteLength,
  });
}

function snapshotForFact(fact, bitmap, unavailable = false) {
  if (fact.state !== "stable" || unavailable) {
    return Object.freeze({
      key: fact.key,
      state: "unavailable",
      contentSignature: "",
      paintSignature: "",
      geometrySignature: "",
      vectorSignature: "",
      canvasSignature: "",
      contentAtoms: 0,
      paintAtoms: 0,
      geometryAtoms: 0,
      vectorAtoms: 0,
      canvasPixels: 0,
    });
  }
  const signature = (digest, count) => count ? `${digest}:${count}` : "";
  return Object.freeze({
    key: fact.key,
    state: "stable",
    contentSignature: signature(fact.contentDigest, fact.contentAtoms),
    paintSignature: signature(fact.paintDigest, fact.paintAtoms),
    geometrySignature: signature(fact.geometryDigest, fact.geometryAtoms),
    vectorSignature: signature(fact.vectorDigest, fact.vectorAtoms),
    canvasSignature: bitmap ? signature(bitmap.digest, bitmap.pixels) : "",
    contentAtoms: fact.contentAtoms,
    paintAtoms: fact.paintAtoms,
    geometryAtoms: fact.geometryAtoms,
    vectorAtoms: fact.vectorAtoms,
    canvasPixels: bitmap?.pixels || 0,
  });
}

function configureIsolatedSession(session, expectedUrl) {
  session?.setPermissionRequestHandler?.((_webContents, _permission, callback) => {
    callback(false);
  });
  session?.setPermissionCheckHandler?.(() => false);
  session?.on?.("will-download", (event) => {
    event.preventDefault();
  });
  session?.webRequest?.onBeforeRequest?.((details, callback) => {
    let allowed = false;
    try {
      const expected = new URL(expectedUrl);
      const requested = new URL(details.url);
      allowed = requested.protocol === "pageroot-preview:"
        && requested.hostname === expected.hostname;
    } catch {
      allowed = false;
    }
    callback({ cancel: !allowed });
  });
}

function ownerExecutor(webContents, source) {
  if (typeof webContents?.executeJavaScriptInIsolatedWorld !== "function") {
    throw new Error("Review runtime capture requires isolated-world evaluation.");
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    REVIEW_CAPTURE_WORLD_ID,
    [{ code: source, url: "pageroot-review-runtime-owner.js" }],
    true,
  );
}

async function settleOwnerCleanup(cleanup) {
  let timeoutId = null;
  const completed = Promise.resolve()
    .then(cleanup)
    .catch(() => undefined);
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
 * Owns a one-use, no-bridge review capture window. The authored page has no
 * path, IPC, private candidate key, comment ID, or challenge channel; it can
 * only influence the disposable facts that are revalidated by this owner.
 */
export function createReviewRuntimeCaptureController({
  BrowserWindowClass,
  createSession,
  revokeSession,
  createIsolatedSession,
  releaseIsolatedSession = async () => {},
  ownerDeadlineMs = RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
  randomToken = () => randomBytes(12).toString("hex"),
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Review runtime capture requires BrowserWindow.");
  }
  if (typeof createSession !== "function" || typeof revokeSession !== "function") {
    throw new TypeError("Review runtime capture requires preview session ownership.");
  }
  if (typeof createIsolatedSession !== "function") {
    throw new TypeError("Review runtime capture requires an isolated session.");
  }
  if (typeof releaseIsolatedSession !== "function") {
    throw new TypeError("Review runtime capture requires isolated session cleanup.");
  }
  const deadlineMs = Math.max(1, Math.min(
    RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
    Math.round(Number(ownerDeadlineMs)) || RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
  ));
  // A review comparison captures the before and after documents in parallel.
  // They must not share a window or session, but neither side should cancel
  // the other. Only a duplicate request for the same review side supersedes
  // its predecessor.
  const activeCaptures = new Map();

  const capture = async (rawRequest) => {
    let request;
    try {
      request = validateReviewRuntimeCaptureRequest(rawRequest);
    } catch {
      return result("failed", "invalid-request");
    }
    if (!requestHasFrozenSourceBindings(request)) {
      return result("unmapped", "frozen-binding-mismatch");
    }
    const operationKey = `${request.captureSessionId}:${request.side}`;
    activeCaptures.get(operationKey)?.cancel("superseded");

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
      const partition = `${REVIEW_CAPTURE_PARTITION_PREFIX}${randomToken()}`;
      isolatedSession = await withOwnerDeadline(createIsolatedSession(partition));
      if (!isolatedSession || typeof isolatedSession !== "object") {
        return result("failed", "invalid-isolated-session");
      }
      configureIsolatedSession(isolatedSession, previewSession.url);
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
      await withOwnerDeadline(captureWindow.loadURL(previewSession.url));
      if (cancellationReason || captureWindow.isDestroyed()) {
        throw new CaptureCancelledError();
      }
      const evaluateFacts = () => withOwnerDeadline(ownerExecutor(
        captureWindow.webContents,
        isolatedFactsScript(request.candidates),
      ));
      const first = normalizedFacts(await evaluateFacts(), request);
      if (!first) return result("failed", "invalid-owner-facts");
      if (first.unmapped) return result("unmapped", "frozen-binding-mismatch");

      const bitmaps = new Map();
      const unavailableKeys = new Set();
      const candidatesByKey = new Map(request.candidates.map((candidate) => [
        candidate.key,
        candidate,
      ]));
      const stableFacts = first.facts.filter((fact) => fact.state === "stable");
      const visualFacts = stableFacts.slice(
        0,
        RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit,
      );
      stableFacts.slice(RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit).forEach((fact) => {
        unavailableKeys.add(fact.key);
      });
      let capturedPixels = 0;
      let capturedBytes = 0;
      for (const fact of visualFacts) {
        const candidate = candidatesByKey.get(fact.key);
        try {
          const viewportValue = candidate
            ? await withOwnerDeadline(ownerExecutor(
                captureWindow.webContents,
                isolatedViewportRectScript(candidate),
              ))
            : null;
          const viewportRect = normalizedViewportRect(viewportValue, request);
          if (!viewportRect) {
            unavailableKeys.add(fact.key);
            continue;
          }
          const remainingPixels = RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels
            - capturedPixels;
          const remainingBytes = RUNTIME_VISUAL_CONTRACT.pageBudget.visualBytes
            - capturedBytes;
          if (
            remainingPixels < 1
            || remainingBytes < 1
            || viewportRect.width * viewportRect.height > remainingPixels
          ) {
            unavailableKeys.add(fact.key);
            continue;
          }
          const firstImage = await withOwnerDeadline(captureWindow.capturePage(viewportRect, {
            stayHidden: true,
          }));
          const firstPng = validatedPng(firstImage);
          if (
            !firstPng
            || firstPng.pixels > remainingPixels
            || firstPng.bytes > remainingBytes
          ) {
            unavailableKeys.add(fact.key);
            continue;
          }
          bitmaps.set(fact.key, firstPng);
          capturedPixels += firstPng.pixels;
          capturedBytes += firstPng.bytes;
        } catch (error) {
          if (error instanceof CaptureTimedOutError || error instanceof CaptureCancelledError) {
            throw error;
          }
          unavailableKeys.add(fact.key);
        }
      }

      const second = normalizedFacts(await evaluateFacts(), request);
      if (!second) return result("failed", "invalid-owner-facts");
      if (second.unmapped) return result("unmapped", "frozen-binding-mismatch");
      const secondByKey = new Map(second.facts.map((fact) => [fact.key, fact]));
      first.facts.forEach((fact) => {
        if (!sameFact(fact, secondByKey.get(fact.key))) unavailableKeys.add(fact.key);
      });
      return captureResult(
        request,
        first.facts.map((fact) => snapshotForFact(
          fact,
          bitmaps.get(fact.key),
          unavailableKeys.has(fact.key),
        )),
      );
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
      if (activeCaptures.get(operationKey) === operation) {
        activeCaptures.delete(operationKey);
      }
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
