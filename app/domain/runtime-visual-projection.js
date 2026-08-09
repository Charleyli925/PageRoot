import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { RUNTIME_VISUAL_CONTRACT } from "./runtime-visual-contract.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
  instrumentPreviewHtml,
  sourceSha256,
} from "../lib/source-index.js";
import {
  createTargetRef,
} from "../lib/target-resolver.js";
import { resolvePageViewContext } from "../lib/page-view-context.js";

export const RUNTIME_VISUAL_PROJECTION_PROTOCOL =
  "pageroot-runtime-visual-projection";
export const RUNTIME_VISUAL_PROJECTION_VERSION = 2;

const MAX_CAPTURE_CANDIDATES = RUNTIME_VISUAL_CONTRACT.candidateLimit;
const MAX_CAPTURE_VISUALS = RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit;
const MAX_TOTAL_VISUAL_BYTES = RUNTIME_VISUAL_CONTRACT.pageBudget.visualBytes;
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
const INLINE_EVENT_HANDLER_ATTRIBUTE = /^on[a-z][a-z0-9]*$/u;
const BROAD_RUNTIME_HOST_MUTATION = /(?:appendChild|insertAdjacentHTML|replaceChildren|\.innerHTML\s*=|document\.createElement|echarts\.init|Highcharts\.chart|Plotly\.newPlot|vegaEmbed|d3\.select|new\s+Chart\s*\()/u;
const INDIRECT_RUNTIME_DOM_READ = /(?:\bdocument\.(?:body|documentElement|forms|images|links)\b|\.(?:children|childNodes|first(?:Child|ElementChild)|last(?:Child|ElementChild)|parent(?:Node|Element)|previous(?:Sibling|ElementSibling)|next(?:Sibling|ElementSibling)|closest)\b|\bgetElementsBy(?:ClassName|TagName|Name)\s*\()/u;
const RUNTIME_DOM_QUERY_CALL = /\bquerySelector(?:All)?\s*\(\s*([^)]*)\)/gu;
const RUNTIME_GET_ELEMENT_BY_ID_CALL = /\bgetElementById\s*\(\s*([^)]*)\)/gu;
const RUNTIME_GET_ELEMENTS_BY_NAME_CALL = /\bgetElementsByName\s*\(\s*([^)]*)\)/gu;
const RUNTIME_CLASS_LOOKUP_CALL = /(?:\bgetElementsByClassName|\bclassList\.(?:add|contains|remove|replace|toggle))\s*\(\s*(["'`])([^"'`]+)\1/gu;
const STABLE_RUNTIME_SELECTOR_LITERAL = /^("|'|`)(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|\[\s*(?:id|name|class|data-[\w-]+)(?:\s*(?:[~|^$*]?=)\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'|`[^`]*`))?\s*\])\1$/u;
const STABLE_RUNTIME_STRING_LITERAL = /^("|'|`)[^"'`]*\1$/u;
const RUNTIME_CLASS_ATTRIBUTE_SELECTOR = /^\[\s*class(?:\s*(?<operator>[~|^$*]?=)\s*(?<value>[A-Za-z0-9_-]+|"[^"]*"|'[^']*'|`[^`]*`))?\s*\]$/u;
const RUNTIME_IDENTITY_ATTRIBUTE_SELECTOR = /^\[\s*(?<name>id|name)(?:\s*(?<operator>[~|^$*]?=)\s*(?<value>[A-Za-z0-9_-]+|"[^"]*"|'[^']*'|`[^`]*`))?\s*\]$/u;
const RUNTIME_DATA_ATTRIBUTE_SELECTOR = /^\[\s*(?<name>data-[\w-]+)(?:\s*(?<operator>[~|^$*]?=)\s*(?<value>[A-Za-z0-9_-]+|"[^"]*"|'[^']*'|`[^`]*`))?\s*\]$/u;
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
  const tokens = [{ value: element.selector, kind: "selector" }];
  for (const attribute of element.attributes ?? []) {
    if (attribute.name === "id" || attribute.name === "name") {
      tokens.push({ value: attribute.name, kind: "identity-attribute" });
      tokens.push({
        value: attribute.value ?? attribute.rawValue ?? "",
        kind: `${attribute.name}-value`,
      });
    }
    if (attribute.name === "class") {
      const classValue = String(attribute.value ?? attribute.rawValue ?? "");
      tokens.push({ value: classValue, kind: "class-value" });
      classValue
        .split(/[\t\n\f\r ]+/u)
        .forEach((token) => tokens.push({ value: token, kind: "class" }));
    }
    if (attribute.name.startsWith("data-")) {
      tokens.push({ value: attribute.name, kind: "data-attribute" });
      tokens.push({
        value: attribute.value ?? attribute.rawValue ?? "",
        kind: "data-value",
        attributeName: attribute.name,
      });
    }
  }
  return tokens.filter(({ value, kind }) => (
    kind === "identity-attribute"
      || kind === "data-value"
      || (
        ["id-value", "name-value", "class", "class-value"].includes(kind)
        && String(value).length > 0
      )
      || String(value).length >= 3
  ));
}

function runtimeSelectorLiteralValue(literal) {
  const trimmed = String(literal || "").trim();
  const quote = trimmed[0];
  return quote && trimmed.at(-1) === quote
    ? trimmed.slice(1, -1)
    : null;
}

function runtimeIdentityValueMatches(source, value, kind) {
  const attributeName = kind === "id-value" ? "id" : "name";
  const lookupCall = kind === "id-value"
    ? RUNTIME_GET_ELEMENT_BY_ID_CALL
    : RUNTIME_GET_ELEMENTS_BY_NAME_CALL;
  if ([...source.matchAll(lookupCall)].some((match) => {
    const literal = match[1].trim();
    return STABLE_RUNTIME_STRING_LITERAL.test(literal)
      && runtimeSelectorLiteralValue(literal) === value;
  })) return true;
  if ([...source.matchAll(RUNTIME_DOM_QUERY_CALL)].some((match) => {
    const literal = match[1].trim();
    if (!STABLE_RUNTIME_SELECTOR_LITERAL.test(literal)) return false;
    const selector = runtimeSelectorLiteralValue(literal);
    if (selector === null) return false;
    if (attributeName === "id" && selector === `#${value}`) return true;
    const attributeSelector = selector.match(RUNTIME_IDENTITY_ATTRIBUTE_SELECTOR);
    if (
      !attributeSelector
      || attributeSelector.groups?.name !== attributeName
      || !attributeSelector.groups?.value
    ) return false;
    const expected = runtimeSelectorLiteralValue(attributeSelector.groups.value)
      ?? attributeSelector.groups.value;
    const actual = String(value);
    if (
      expected.length === 0
      && ["^=", "$=", "*="].includes(attributeSelector.groups.operator)
    ) return false;
    switch (attributeSelector.groups.operator) {
      case "=":
        return actual === expected;
      case "~=":
        return actual.split(/[\t\n\f\r ]+/u).includes(expected);
      case "^=":
        return actual.startsWith(expected);
      case "$=":
        return actual.endsWith(expected);
      case "*=":
        return actual.includes(expected);
      case "|=":
        return actual === expected || actual.startsWith(`${expected}-`);
      default:
        return false;
    }
  })) return true;
  if (kind !== "id-value") return false;
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${escapedValue}(?=\\s*\\.)`, "u").test(source);
}

function runtimeAttributeSelectorMatches(source, value, kind) {
  return [...source.matchAll(RUNTIME_DOM_QUERY_CALL)].some((match) => {
    const literal = match[1].trim();
    if (!STABLE_RUNTIME_SELECTOR_LITERAL.test(literal)) return false;
    const selector = runtimeSelectorLiteralValue(literal);
    if (selector === null) return false;
    if (kind === "identity-attribute") {
      const identitySelector = selector.match(RUNTIME_IDENTITY_ATTRIBUTE_SELECTOR);
      return identitySelector?.groups?.name === value
        && !identitySelector.groups.operator;
    }
    const classSelector = selector.match(RUNTIME_CLASS_ATTRIBUTE_SELECTOR);
    if (!classSelector) return false;
    if (!classSelector.groups?.value) return true;
    const expected = runtimeSelectorLiteralValue(classSelector.groups.value)
      ?? classSelector.groups.value;
    const actual = String(value);
    if (
      expected.length === 0
      && ["~=", "^=", "$=", "*="].includes(classSelector.groups.operator)
    ) return false;
    switch (classSelector.groups.operator) {
      case "=":
        return kind === "class-value" && expected === actual;
      case "~=":
        return kind === "class"
          ? expected === actual
          : actual.split(/[\t\n\f\r ]+/u).includes(expected);
      case "^=":
        return kind === "class-value"
          && actual.startsWith(expected);
      case "$=":
        return kind === "class-value"
          && actual.endsWith(expected);
      case "*=":
        return kind === "class-value"
          && actual.includes(expected);
      case "|=":
        return kind === "class-value"
          && (actual === expected || actual.startsWith(`${expected}-`));
      default:
        return false;
    }
  });
}

function runtimeDataAttributeSelectorMatches(source, attributeName, value, kind) {
  let sawAttributeSelector = false;
  for (const match of source.matchAll(RUNTIME_DOM_QUERY_CALL)) {
    const literal = match[1].trim();
    if (!STABLE_RUNTIME_SELECTOR_LITERAL.test(literal)) continue;
    const selector = runtimeSelectorLiteralValue(literal);
    if (selector === null) continue;
    const dataSelector = selector.match(RUNTIME_DATA_ATTRIBUTE_SELECTOR);
    if (dataSelector?.groups?.name !== attributeName) continue;
    sawAttributeSelector = true;
    const operator = dataSelector.groups.operator;
    if (kind === "data-attribute") {
      if (!operator) return true;
      continue;
    }
    if (kind !== "data-value" || !operator) continue;
    const expected = runtimeSelectorLiteralValue(dataSelector.groups.value)
      ?? dataSelector.groups.value;
    const actual = String(value);
    if (
      expected.length === 0
      && ["^=", "$=", "*="].includes(operator)
    ) continue;
    if (
      (operator === "=" && actual === expected)
      || (operator === "~=" && actual.split(/[\t\n\f\r ]+/u).includes(expected))
      || (operator === "^=" && actual.startsWith(expected))
      || (operator === "$=" && actual.endsWith(expected))
      || (operator === "*=" && actual.includes(expected))
      || (operator === "|=" && (actual === expected || actual.startsWith(`${expected}-`)))
    ) return true;
  }
  return sawAttributeSelector ? false : null;
}

function sourceReferencesToken(source, tokenDescriptor) {
  const value = String(
    typeof tokenDescriptor === "object"
      ? tokenDescriptor?.value
      : tokenDescriptor,
  );
  const kind = typeof tokenDescriptor === "object"
    ? tokenDescriptor?.kind
    : "identity";
  const exactNamespaceKind = [
    "id-value",
    "name-value",
    "class",
    "class-value",
    "data-value",
  ].includes(kind);
  if (
    value.length < 3
    && kind !== "identity-attribute"
    && !exactNamespaceKind
  ) return false;
  if (kind === "id-value" || kind === "name-value") {
    return runtimeIdentityValueMatches(source, value, kind);
  }
  if (kind === "data-attribute" || kind === "data-value") {
    const dataSelectorReference = runtimeDataAttributeSelectorMatches(
      source,
      tokenDescriptor?.attributeName ?? value,
      value,
      kind,
    );
    if (dataSelectorReference !== null) return dataSelectorReference;
    if (kind === "data-attribute") return false;
    if (value.length < 3) return false;
  }
  const attributeSelectorReference = (
    (kind === "class" || kind === "class-value" || kind === "identity-attribute")
    && runtimeAttributeSelectorMatches(source, value, kind)
  );
  if (kind === "identity-attribute") return attributeSelectorReference;
  if (attributeSelectorReference) return true;
  if (kind === "class-value") {
    return [...source.matchAll(RUNTIME_CLASS_LOOKUP_CALL)].some((match) => (
      String(match[2]) === value
    ));
  }
  let offset = source.indexOf(value);
  while (offset >= 0) {
    const before = offset > 0 ? source[offset - 1] : "";
    const after = source[offset + value.length] || "";
    const classSelectorPunctuation = (
      kind === "class"
      && before === "."
      && !/[A-Za-z0-9_.:-]/u.test(source[offset - 2] || "")
    );
    if (
      kind === "class"
      && !classSelectorPunctuation
      && ![...source.matchAll(RUNTIME_CLASS_LOOKUP_CALL)].some((match) => (
        String(match[2])
          .split(/[\t\n\f\r ]+/u)
          .includes(value)
      ))
    ) {
      offset = source.indexOf(value, offset + 1);
      continue;
    }
    if (
      (classSelectorPunctuation || !/[A-Za-z0-9_.:-]/u.test(before))
      && !/[A-Za-z0-9_.:-]/u.test(after)
    ) return true;
    offset = source.indexOf(value, offset + 1);
  }
  return false;
}

function runtimeExecutableSources(sourceIndex) {
  const scripts = sourceIndex.elements.filter(
    (element) => element.tagName === "script",
  );
  const handlers = [];
  for (const element of sourceIndex.elements) {
    for (const attribute of element.attributes ?? []) {
      const value = attribute.value ?? attribute.rawValue;
      if (
        INLINE_EVENT_HANDLER_ATTRIBUTE.test(attribute.name)
        && typeof value === "string"
        && value.length > 0
      ) {
        handlers.push({ element, attribute, value });
      }
    }
  }
  return {
    scripts,
    handlers,
    source: [
      ...scripts.map((element) => element.raw),
      ...handlers.map((handler) => handler.value),
    ].join("\n"),
  };
}

function usesIndirectRuntimeDomRead(source) {
  if (INDIRECT_RUNTIME_DOM_READ.test(source)) return true;
  return [...source.matchAll(RUNTIME_DOM_QUERY_CALL)].some((match) => (
    !STABLE_RUNTIME_SELECTOR_LITERAL.test(match[1].trim())
  )) || [...source.matchAll(RUNTIME_GET_ELEMENT_BY_ID_CALL)].some((match) => (
    !STABLE_RUNTIME_STRING_LITERAL.test(match[1].trim())
  ));
}

function candidateBelongsToHandlerOwner(
  sourceIndex,
  element,
  handlerOwnerNodeIds,
) {
  let current = element;
  while (current?.type === "element") {
    if (handlerOwnerNodeIds.has(current.nodeId)) return true;
    current = current.parentId
      ? sourceIndex.byNodeId.get(current.parentId)
      : null;
  }
  return false;
}

function runtimeReferencedCandidates(sourceIndex, candidates) {
  const { scripts, handlers, source } = runtimeExecutableSources(sourceIndex);
  if (scripts.length === 0 && handlers.length === 0) return [];
  const handlerOwnerNodeIds = new Set(
    handlers.map((handler) => handler.element.nodeId),
  );
  const referenced = candidates.filter((candidate) => {
    const element = sourceIndex.byNodeId.get(candidate.sourceNodeId);
    return element?.type === "element" && (
      candidateBelongsToHandlerOwner(
        sourceIndex,
        element,
        handlerOwnerNodeIds,
      )
      || candidateReferenceTokens(element).some((token) => (
        sourceReferencesToken(source, token)
      ))
    );
  });
  const hasExternalScript = scripts.some(
    (element) => (element.attributesByName.get("src")?.length ?? 0) === 1,
  );
  if (
    hasExternalScript
    || BROAD_RUNTIME_HOST_MUTATION.test(source)
    || usesIndirectRuntimeDomRead(source)
  ) {
    const referencedIds = new Set(
      referenced.map((candidate) => candidate.sourceNodeId),
    );
    return [
      ...referenced,
      ...candidates.filter((candidate) => !referencedIds.has(candidate.sourceNodeId)),
    ];
  }
  return referenced;
}

function captureCandidates(sourceIndex) {
  const placeholders = sourceIndex.elements
    .filter((element) => (
      VISUAL_HOST_TAGS.has(element.tagName)
      && sourceVisualPlaceholder(sourceIndex, element)
    ))
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
  return runtimeReferencedCandidates(sourceIndex, placeholders)
    .slice(0, MAX_CAPTURE_CANDIDATES);
}

function runtimeDependencySha256(sourceIndex, candidates) {
  const { handlers, source: scriptSource } = runtimeExecutableSources(sourceIndex);
  const executableSources = sourceIndex.elements
    .filter((element) => RUNTIME_DEPENDENCY_TAGS.has(element.tagName))
    .map((element) => [element.tagName, element.selector, element.raw]);
  for (const handler of handlers) {
    executableSources.push([
      "event-handler",
      handler.element.selector,
      handler.attribute.name,
      handler.value,
    ]);
  }
  const referencedDataSources = scriptSource
    ? sourceIndex.elements
      .filter((element) => (
        !RUNTIME_DEPENDENCY_TAGS.has(element.tagName)
        && candidateReferenceTokens(element).some((token) => (
          sourceReferencesToken(scriptSource, token)
        ))
      ))
      .map((element) => [element.tagName, element.selector, element.raw])
    : [];
  return sourceSha256(JSON.stringify({
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    candidates: candidates.map((candidate) => candidate.captureKey),
    executableSources,
    referencedDataSources,
    ...(usesIndirectRuntimeDomRead(scriptSource)
      ? { indirectDomSourceSha256: sourceIndex.sourceSha256 }
      : {}),
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
  if (projection.sourceSha256 !== sourceIndex.sourceSha256) return null;
  return finalizeAcceptedProjection({
    ...projection,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
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
  const fallback = fallbackProjection;
  if (
    !fallback
    || !acceptedProjectionAuthority.has(fallback)
    || fallback.documentKey !== documentKey
    || fallback.sourceSha256 !== sourceIndex.sourceSha256
  ) return projection;
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
