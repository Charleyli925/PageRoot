import {
  attributesFor,
  hasCompleteDocumentStructure,
  parseHtmlSource,
  visitElements,
} from "./html-source-parser.mjs";
import {
  inspectSourceElementIdentity,
} from "./project-file-repository/working-copy.mjs";
import {
  isValidPagerootElementId,
} from "../shared/pageroot-element-identity.mjs";

export const CANDIDATE_ASSESSMENT_SCHEMA_VERSION = "1.0.0";

const IGNORED_TEXT_ELEMENTS = new Set([
  "script",
  "style",
  "template",
  "noscript",
]);
const NON_RENDERING_BODY_ELEMENTS = new Set([
  "base",
  "link",
  "meta",
  "script",
  "style",
  "template",
  "title",
]);
const ASSET_ATTRIBUTES = new Set([
  "href",
  "poster",
  "src",
]);
const MAX_CONTINUITY_TEXT_CODEPOINTS = 100_000;
const TEXT_SHINGLE_SIZE = 4;
const IMPACT_ARRAY_FIELDS = Object.freeze([
  "changedStableElementIds",
  "requestedTargetElementIds",
  "outsideRequestedTargetElementIds",
]);

function normalizedVisibleText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .slice(0, MAX_CONTINUITY_TEXT_CODEPOINTS);
}

function textContent(node, ignored = false) {
  const nextIgnored = ignored || (
    typeof node?.tagName === "string"
    && IGNORED_TEXT_ELEMENTS.has(node.tagName)
  );
  if (node?.nodeName === "#text") {
    return nextIgnored ? "" : String(node.value || "");
  }
  let result = "";
  for (const child of node?.childNodes ?? []) {
    result += textContent(child, nextIgnored);
  }
  if (node?.content) result += textContent(node.content, nextIgnored);
  return result;
}

function firstElement(document, tagName) {
  let result = null;
  visitElements(document, (node) => {
    if (!result && node.tagName === tagName) result = node;
  });
  return result;
}

function shingleSet(value) {
  const codepoints = [...normalizedVisibleText(value)];
  if (codepoints.length === 0) return new Set();
  if (codepoints.length <= TEXT_SHINGLE_SIZE) {
    return new Set([codepoints.join("")]);
  }
  const result = new Set();
  for (let index = 0; index <= codepoints.length - TEXT_SHINGLE_SIZE; index += 1) {
    result.add(codepoints.slice(index, index + TEXT_SHINGLE_SIZE).join(""));
  }
  return result;
}

function normalizedAssetReference(value) {
  const raw = String(value || "").trim();
  if (
    !raw
    || raw.startsWith("#")
    || /^(?:data|javascript|blob):/iu.test(raw)
  ) return "";
  try {
    const parsed = new URL(raw, "https://pageroot.invalid/");
    return `${parsed.origin === "https://pageroot.invalid" ? "" : parsed.origin}${parsed.pathname}`
      .toLocaleLowerCase("und");
  } catch {
    return raw.split(/[?#]/u, 1)[0].toLocaleLowerCase("und");
  }
}

function continuityFingerprint(html) {
  const parsed = parseHtmlSource(html);
  const body = firstElement(parsed.document, "body");
  const title = firstElement(parsed.document, "title");
  const anchors = new Set();
  const classes = new Set();
  const assets = new Set();
  let bodyElementCount = 0;

  if (body) {
    visitElements(body, (node) => {
      if (!NON_RENDERING_BODY_ELEMENTS.has(node.tagName)) bodyElementCount += 1;
      const attributes = attributesFor(node);
      for (const [name, rawValue] of attributes) {
        const value = String(rawValue || "").trim();
        if (!value) continue;
        if (name === "id") anchors.add(`id:${value}`);
        if (
          name.startsWith("data-")
          && !name.startsWith("data-html-canvas-")
          && !name.startsWith("data-pageroot-")
        ) {
          anchors.add(`${name}:${value}`);
        }
        if (name === "class") {
          value.split(/\s+/u).filter(Boolean).forEach((token) => classes.add(token));
        }
        if (ASSET_ATTRIBUTES.has(name)) {
          const reference = normalizedAssetReference(value);
          if (reference) assets.add(`${node.tagName}:${name}:${reference}`);
        }
      }
    });
  }

  const visibleText = normalizedVisibleText(textContent(body));
  return {
    parseErrorCount: parsed.parseErrors.length,
    bodyElementCount,
    visibleTextLength: [...visibleText].length,
    title: normalizedVisibleText(textContent(title)),
    textShingles: shingleSet(visibleText),
    anchors,
    classes,
    assets,
  };
}

function overlap(left, right) {
  let shared = 0;
  for (const value of left) {
    if (right.has(value)) shared += 1;
  }
  const denominator = Math.min(left.size, right.size);
  return {
    shared,
    score: denominator === 0 ? null : shared / denominator,
  };
}

function roundedScore(value) {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

function continuityAssessment(baseHtml, outputHtml) {
  const base = continuityFingerprint(baseHtml);
  const output = continuityFingerprint(outputHtml);
  const text = overlap(base.textShingles, output.textShingles);
  const anchors = overlap(base.anchors, output.anchors);
  const classes = overlap(base.classes, output.classes);
  const assets = overlap(base.assets, output.assets);
  const sameTitle = Boolean(base.title && base.title === output.title);

  let evidencePoints = 0;
  if (
    text.score !== null
    && text.score >= 0.08
    && (
      text.shared >= 8
      || Math.min(base.textShingles.size, output.textShingles.size) < 8
    )
  ) evidencePoints += 2;
  if (anchors.shared >= 2) evidencePoints += 2;
  else if (anchors.shared === 1 && text.shared > 0) evidencePoints += 1;
  if (assets.shared >= 1) evidencePoints += 1;
  if (classes.shared >= 4 && (classes.score ?? 0) >= 0.2) evidencePoints += 1;
  if (sameTitle) evidencePoints += 1;

  const hasComparableSignals = Boolean(
    base.textShingles.size
    || base.anchors.size
    || base.classes.size
    || base.assets.size
    || base.title,
  );
  return {
    status: hasComparableSignals && evidencePoints >= 2
      ? "related"
      : "uncertain",
    evidencePoints,
    sameTitle,
    text: {
      score: roundedScore(text.score),
      shared: text.shared,
      base: base.textShingles.size,
      output: output.textShingles.size,
    },
    anchors: {
      score: roundedScore(anchors.score),
      shared: anchors.shared,
      base: base.anchors.size,
      output: output.anchors.size,
    },
    classes: {
      score: roundedScore(classes.score),
      shared: classes.shared,
      base: base.classes.size,
      output: output.classes.size,
    },
    assets: {
      score: roundedScore(assets.score),
      shared: assets.shared,
      base: base.assets.size,
      output: output.assets.size,
    },
    baseVisibleTextLength: base.visibleTextLength,
    outputVisibleTextLength: output.visibleTextLength,
    baseBodyElementCount: base.bodyElementCount,
    outputBodyElementCount: output.bodyElementCount,
    baseParseErrorCount: base.parseErrorCount,
    outputParseErrorCount: output.parseErrorCount,
  };
}

function authoredChildren(element) {
  return element?.nodeName === "template" && element.content
    ? element.content.childNodes ?? []
    : element?.childNodes ?? [];
}

function normalizedOwnSource(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function startTagWithoutStableId(source, element) {
  const ranges = (element.identityAttributes || [])
    .map((attribute) => attribute.range)
    .filter((range) => (
      Number.isInteger(range?.startOffset)
      && Number.isInteger(range?.endOffset)
      && range.startOffset >= element.startOffset
      && range.endOffset <= element.endOffset
      && range.endOffset > range.startOffset
    ))
    .sort((left, right) => left.startOffset - right.startOffset);
  if (ranges.length === 0) {
    return source.slice(element.startOffset, element.endOffset);
  }
  const parts = [];
  let cursor = element.startOffset;
  for (const range of ranges) {
    if (range.startOffset < cursor) continue;
    parts.push(source.slice(cursor, range.startOffset));
    cursor = range.endOffset;
  }
  parts.push(source.slice(cursor, element.endOffset));
  return parts.join("");
}

function siblingIndexFor(inspection, elementIndex, element) {
  const parentIndex = element.parentElementIndex;
  if (!Number.isInteger(parentIndex)) return 0;
  return inspection.elements
    .slice(0, elementIndex)
    .filter((candidate) => candidate.parentElementIndex === parentIndex)
    .length;
}

function stableElementSignatures(source) {
  let inspection;
  try {
    inspection = inspectSourceElementIdentity(source);
  } catch {
    return null;
  }
  // Candidate identity validation owns malformed/duplicate identity errors.
  // Assessment remains conservative if it is called directly with such input.
  if (!inspection.valid) return null;
  const parsed = parseHtmlSource(source);
  const nodeByStartOffset = new Map(
    parsed.elements
      .filter((token) => Number.isInteger(token.start))
      .map((token) => [token.start, token.node]),
  );
  const signatures = new Map();
  for (const [elementIndex, element] of inspection.elements.entries()) {
    const id = element.pagerootId;
    if (!isValidPagerootElementId(id)) continue;
    if (signatures.has(id)) return null;
    const directText = authoredChildren(nodeByStartOffset.get(element.startOffset))
      .filter((child) => child?.nodeName === "#text")
      .map((child) => child.value ?? "")
      .join("");
    const parent = Number.isInteger(element.parentElementIndex)
      ? inspection.elements[element.parentElementIndex]
      : null;
    signatures.set(id, JSON.stringify({
      namespaceURI: String(element.node?.namespaceURI || ""),
      tagName: String(element.tagName || "").toLowerCase(),
      startTag: normalizedOwnSource(startTagWithoutStableId(source, element)),
      endTag: element.explicitEndTag
        ? normalizedOwnSource(source.slice(element.contentEndOffset, element.sourceEndOffset))
        : "",
      parentId: isValidPagerootElementId(parent?.pagerootId)
        ? parent.pagerootId
        : null,
      siblingIndex: siblingIndexFor(inspection, elementIndex, element),
      directText: normalizedOwnSource(directText),
    }));
  }
  return signatures;
}

function normalizedRequestedTargetIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => isValidPagerootElementId(value)),
  )].sort();
}

function candidateImpact(
  baseHtml,
  outputHtml,
  requestedTargetElementIds,
  requestedTargetCount,
) {
  const requested = normalizedRequestedTargetIds(requestedTargetElementIds);
  const base = stableElementSignatures(baseHtml);
  const output = stableElementSignatures(outputHtml);
  const changed = base && output
    ? [...new Set([...base.keys(), ...output.keys()])]
      .filter((id) => base.get(id) !== output.get(id))
      .sort()
    : [];
  const requestedSet = new Set(requested);
  return {
    changedStableElementIds: changed,
    requestedTargetElementIds: requested,
    outsideRequestedTargetElementIds: changed.filter((id) => !requestedSet.has(id)),
    requestedTargetCount: Number.isSafeInteger(requestedTargetCount)
      && requestedTargetCount >= 0
      ? requestedTargetCount
      : requested.length,
  };
}

export function candidateAssessmentDecision({
  completeDocument,
  bodyHasContent,
  continuityStatus,
}) {
  if (!completeDocument) {
    return {
      status: "blocked",
      issueCodes: ["HTML_DOCUMENT_INCOMPLETE"],
    };
  }
  if (!bodyHasContent) {
    return {
      status: "blocked",
      issueCodes: ["HTML_BODY_EMPTY"],
    };
  }
  if (continuityStatus === "uncertain") {
    return {
      status: "attention",
      issueCodes: ["PAGE_CONTINUITY_UNCERTAIN"],
    };
  }
  return { status: "ready", issueCodes: [] };
}

export function assessHtmlCandidate({
  baseHtml,
  outputHtml,
  requestedTargetElementIds = [],
  requestedTargetCount = null,
  includeImpact = true,
}) {
  const completeDocument = hasCompleteDocumentStructure(outputHtml);
  const continuity = continuityAssessment(baseHtml, outputHtml);
  const bodyHasContent = Boolean(
    continuity.outputVisibleTextLength > 0
    || continuity.outputBodyElementCount > 0
  );
  const decision = candidateAssessmentDecision({
    completeDocument,
    bodyHasContent,
    continuityStatus: continuity.status,
  });

  const assessment = {
    schemaVersion: CANDIDATE_ASSESSMENT_SCHEMA_VERSION,
    ...decision,
    health: {
      completeDocument,
      bodyHasContent,
    },
    continuity,
  };
  if (includeImpact) {
    Object.assign(
      assessment,
      candidateImpact(
        baseHtml,
        outputHtml,
        requestedTargetElementIds,
        requestedTargetCount,
      ),
    );
  }
  return assessment;
}

export { IMPACT_ARRAY_FIELDS };
