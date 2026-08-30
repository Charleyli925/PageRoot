import {
  alignReviewSemanticUnits,
} from "../../app/lib/review-semantic-alignment.js";
import {
  attributesFor,
  parseHtmlSource,
} from "../../bridge/html-source-parser.mjs";

const ID_ATTRIBUTE = "data-pageroot-id";

function elementChildren(node) {
  const children = (node?.childNodes ?? []).filter(
    (child) => typeof child?.tagName === "string",
  );
  if (node?.content) children.push(...elementChildren(node.content));
  return children;
}

function elementDescendants(node) {
  const children = elementChildren(node);
  return children.flatMap((child) => [child, ...elementDescendants(child)]);
}

function normalizedText(node) {
  if (node?.nodeName === "#text") return String(node.value || "");
  return (node?.childNodes ?? []).map(normalizedText).join("")
    + (node?.content ? normalizedText(node.content) : "");
}

function authoredAttributes(node) {
  return [...attributesFor(node)]
    .filter(([name]) => name !== ID_ATTRIBUTE)
    .sort(([left], [right]) => left.localeCompare(right));
}

function fixtureAnchor(node) {
  const attributes = authoredAttributes(node);
  const id = attributes.find(([name]) => name === "id");
  if (id) return `id:${id[1]}`;
  const data = attributes.find(([name]) => (
    name.startsWith("data-")
    && !name.startsWith("data-html-")
  ));
  return data ? `${data[0]}:${String(data[1] || "")}` : null;
}

function sourceSignature(source, node) {
  const location = node?.sourceCodeLocation;
  if (!Number.isInteger(location?.startOffset) || !Number.isInteger(location?.endOffset)) {
    return "";
  }
  return source.slice(location.startOffset, location.endOffset)
    .replace(/\s+data-pageroot-id\s*=\s*(?:"pr1_[a-f0-9]{32}"|'pr1_[a-f0-9]{32}'|pr1_[a-f0-9]{32})/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function unit(source, node) {
  const attributes = authoredAttributes(node);
  return {
    kind: node.tagName,
    text: normalizedText(node),
    stableId: fixtureAnchor(node),
    exactSignature: sourceSignature(source, node),
    compatibilitySignature: JSON.stringify([
      node.tagName,
      attributes.map(([name]) => name).filter((name) => name !== "style"),
    ]),
    affinities: attributes.map(([name, value]) => `${name}:${value}`),
    parentKey: "fixture-parent",
  };
}

function closingDelimiterOffset(source, node) {
  const startTag = node?.sourceCodeLocation?.startTag;
  if (!Number.isInteger(startTag?.endOffset)) return null;
  let cursor = startTag.endOffset - 1;
  while (cursor > startTag.startOffset && /\s/u.test(source[cursor])) cursor -= 1;
  if (source[cursor] !== ">") return null;
  cursor -= 1;
  while (cursor > startTag.startOffset && /\s/u.test(source[cursor])) cursor -= 1;
  return source[cursor] === "/" ? cursor : startTag.endOffset - 1;
}

/**
 * Test-fixture authoring helper only. It simulates an AI that retained IDs
 * while a large legacy Review fixture continues to express edits as strings.
 * Product Candidate validation deliberately does not import or reproduce this
 * semantic pairing fallback.
 */
export function preserveCandidateSourceIdsForFixture(baseHtml, candidateWithoutIds) {
  const base = parseHtmlSource(baseHtml);
  const candidate = parseHtmlSource(candidateWithoutIds);
  const pairedIds = new Map();
  const pairedBaseNodes = new Set();
  const pairedCandidateNodes = new Set();
  const recordPair = (baseNode, candidateNode) => {
    if (pairedBaseNodes.has(baseNode) || pairedCandidateNodes.has(candidateNode)) return false;
    pairedBaseNodes.add(baseNode);
    pairedCandidateNodes.add(candidateNode);
    const pagerootId = attributesFor(baseNode).get(ID_ATTRIBUTE);
    if (pagerootId) pairedIds.set(candidateNode, pagerootId);
    return true;
  };
  const pairRemainingByTag = (before, after, {
    allowedTags = null,
    singletonOnly = false,
  } = {}) => {
    const beforeByTag = new Map();
    const afterByTag = new Map();
    for (const node of before.filter((value) => !pairedBaseNodes.has(value))) {
      const values = beforeByTag.get(node.tagName) ?? [];
      values.push(node);
      beforeByTag.set(node.tagName, values);
    }
    for (const node of after.filter((value) => !pairedCandidateNodes.has(value))) {
      const values = afterByTag.get(node.tagName) ?? [];
      values.push(node);
      afterByTag.set(node.tagName, values);
    }
    for (const [tagName, baseNodes] of beforeByTag) {
      if (allowedTags && !allowedTags.has(tagName)) continue;
      const candidateNodes = afterByTag.get(tagName) ?? [];
      if (singletonOnly && (baseNodes.length !== 1 || candidateNodes.length !== 1)) {
        continue;
      }
      for (let index = 0; index < Math.min(baseNodes.length, candidateNodes.length); index += 1) {
        recordPair(baseNodes[index], candidateNodes[index]);
      }
    }
  };
  const pairChildren = (baseParent, candidateParent) => {
    const before = elementChildren(baseParent);
    const after = elementChildren(candidateParent);
    const alignment = alignReviewSemanticUnits(
      before.map((node) => unit(base.source, node)),
      after.map((node) => unit(candidate.source, node)),
    );
    for (const alignmentPair of alignment) {
      if (alignmentPair.beforeIndex === null || alignmentPair.afterIndex === null) continue;
      const baseNode = before[alignmentPair.beforeIndex];
      const candidateNode = after[alignmentPair.afterIndex];
      recordPair(baseNode, candidateNode);
      pairChildren(baseNode, candidateNode);
    }
    // Repeated void elements such as <br> have no semantic content for the
    // Review aligner. The legacy fixture still models an AI that retained
    // their identities, so pair remaining same-tag siblings in source order.
    pairRemainingByTag(before, after, { allowedTags: new Set(["br"]) });
    for (const candidateNode of after) {
      const pagerootId = pairedIds.get(candidateNode);
      if (!pagerootId) continue;
      const baseNode = before.find(
        (value) => attributesFor(value).get(ID_ATTRIBUTE) === pagerootId,
      );
      if (baseNode) pairChildren(baseNode, candidateNode);
    }

    // Some fixture edits remove a wrapper while retaining its only authored
    // descendant (for example <span><strong>...</strong></span> -> <strong>).
    // Limit this fallback to a shared explicit fixture anchor so it cannot
    // pair unrelated branches of the large document.
    const baseAnchor = fixtureAnchor(baseParent);
    if (baseAnchor && baseAnchor === fixtureAnchor(candidateParent)) {
      pairRemainingByTag(
        elementDescendants(baseParent),
        elementDescendants(candidateParent),
        { singletonOnly: true },
      );
    }
  };
  pairChildren(base.document, candidate.document);

  const insertions = [...pairedIds].flatMap(([node, pagerootId]) => {
    if (attributesFor(node).has(ID_ATTRIBUTE)) return [];
    const offset = closingDelimiterOffset(candidate.source, node);
    return Number.isInteger(offset)
      ? [{ offset, value: ` ${ID_ATTRIBUTE}="${pagerootId}"` }]
      : [];
  }).sort((left, right) => right.offset - left.offset);
  let result = candidate.source;
  for (const insertion of insertions) {
    result = result.slice(0, insertion.offset)
      + insertion.value
      + result.slice(insertion.offset);
  }
  return result;
}
