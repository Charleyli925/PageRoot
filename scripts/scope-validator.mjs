import { createHash } from "node:crypto";

import { decodeHTMLAttribute } from "entities";
import { parse } from "parse5";

import {
  comparisonSha256,
  MANAGED_META_NAMES,
  sha256,
} from "./lifecycle-core.mjs";
import {
  isStalePositionalTarget,
  matchingFingerprintPrefixCount,
  normalizedSha256 as normalizedSha,
} from "./target-identity.mjs";

export const SCOPE_REPORT_SCHEMA_VERSION = "1.0.0";
export const SCOPE_VALIDATOR_VERSION = "1.0.0";
export const SCOPE_ENFORCEMENT_MODE = "enforce";

const MANAGED_META_NAME_SET = new Set(MANAGED_META_NAMES);
const STABLE_FINGERPRINT_ATTRIBUTE_NAMES = new Set([
  "id",
  "name",
  "role",
  "title",
  "href",
  "src",
  "alt",
  "type",
  "value",
  "for",
]);
const MAX_PREVIEW_LENGTH = 2_000;
const MAX_ALIGNMENT_CELLS = 250_000;
const GAP_PENALTY = -40;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function evidence(value) {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value ?? null);
  return {
    sha256: sha256(Buffer.from(text, "utf8")),
    preview: text.slice(0, MAX_PREVIEW_LENGTH),
  };
}

function attributesFor(node) {
  return new Map(
    (node.attrs ?? []).map((attribute) => [
      attribute.name.toLowerCase(),
      attribute.value,
    ]),
  );
}

function sourceSlice(source, location) {
  if (
    !Number.isInteger(location?.startOffset)
    || !Number.isInteger(location?.endOffset)
  ) {
    return "";
  }
  return source.slice(location.startOffset, location.endOffset);
}

export function rawStartTagAttributes(source, location) {
  const raw = sourceSlice(source, location);
  if (!raw.startsWith("<")) return [];
  const attributes = [];
  let cursor = 1;
  while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
  while (
    cursor < raw.length
    && !/[\s/>]/u.test(raw[cursor])
  ) {
    cursor += 1;
  }
  while (cursor < raw.length) {
    while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
    if (
      cursor >= raw.length
      || raw[cursor] === ">"
      || (raw[cursor] === "/" && raw[cursor + 1] === ">")
    ) {
      break;
    }
    const nameStart = cursor;
    while (
      cursor < raw.length
      && !/[\s=/>]/u.test(raw[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = raw.slice(nameStart, cursor).toLowerCase();
    while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
    let value = "";
    if (raw[cursor] === "=") {
      cursor += 1;
      while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
      const quote = raw[cursor] === '"' || raw[cursor] === "'"
        ? raw[cursor]
        : null;
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < raw.length && raw[cursor] !== quote) cursor += 1;
        value = raw.slice(valueStart, cursor);
        if (raw[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (
          cursor < raw.length
          && !/[\s>]/u.test(raw[cursor])
        ) {
          cursor += 1;
        }
        value = raw.slice(valueStart, cursor);
      }
    }
    attributes.push({ name, value: decodeHTMLAttribute(value) });
  }
  return attributes;
}

function attributeRecordsForNode(node) {
  if (node?.location?.startTag) return node.rawAttributes;
  return [...(node?.attributes ?? new Map()).entries()].map(
    ([name, value]) => ({ name, value }),
  );
}

function attributeValuesByName(node) {
  const values = new Map();
  for (const attribute of attributeRecordsForNode(node)) {
    const list = values.get(attribute.name) ?? [];
    list.push(attribute.value);
    values.set(attribute.name, list);
  }
  return values;
}

function semanticAttributeSequence(node) {
  return attributeRecordsForNode(node)
    .map(({ name, value }) => [name, value]);
}

function isManagedMetaNode(node, rawAttributes) {
  const names = rawAttributes.filter((attribute) => attribute.name === "name");
  const contents = rawAttributes.filter(
    (attribute) => attribute.name === "content",
  );
  return (
    node?.tagName === "meta"
    && names.length === 1
    && contents.length <= 1
    && rawAttributes.every(
      (attribute) => ["name", "content"].includes(attribute.name),
    )
    && MANAGED_META_NAME_SET.has(names[0].value.toLowerCase())
  );
}

function childNodesFor(node) {
  const children = [...(node?.childNodes ?? [])];
  if (node?.content?.childNodes) children.push(...node.content.childNodes);
  return children;
}

function sourceLocation(node) {
  return node?.sourceCodeLocation ?? null;
}

function nodeType(node) {
  if (typeof node?.tagName === "string") return "element";
  if (node?.nodeName === "#text") return "text";
  if (node?.nodeName === "#comment") return "comment";
  if (node?.nodeName === "#documentType") return "doctype";
  return "document";
}

function semanticValueForNode(node) {
  switch (node.type) {
    case "element":
      return {
        type: node.type,
        tagName: node.tagName,
        namespaceURI: node.namespaceURI,
        attributes: semanticAttributeSequence(node),
      };
    case "text":
      return { type: node.type, value: node.value };
    case "comment":
      return { type: node.type, value: node.value };
    case "doctype":
      return {
        type: node.type,
        name: node.name,
        publicId: node.publicId,
        systemId: node.systemId,
      };
    default:
      return { type: node.type };
  }
}

function buildPath(node, parent, siblingCounters) {
  if (!parent) return "/";
  const key =
    node.type === "element"
      ? node.tagName
      : node.type === "text"
        ? "#text"
        : node.type === "comment"
          ? "#comment"
          : node.type === "doctype"
            ? "#doctype"
            : "#document";
  const ordinal = (siblingCounters.get(key) ?? 0) + 1;
  siblingCounters.set(key, ordinal);
  return `${parent.path === "/" ? "" : parent.path}/${key}[${ordinal}]`;
}

function buildTree(html) {
  const source = String(html);
  const document = parse(source, { sourceCodeLocationInfo: true });
  const elements = [];
  const textNodes = [];
  const managedMetadata = [];
  let nextNodeOrdinal = 1;

  const visit = (original, parent, siblingCounters, managedParentPath = "/") => {
    const type = nodeType(original);
    const location = sourceLocation(original);
    const rawAttributes = type === "element"
      ? rawStartTagAttributes(source, location?.startTag)
      : [];
    if (isManagedMetaNode(original, rawAttributes)) {
      const attributes = attributesFor(original);
      managedMetadata.push({
        name: attributes.get("name")?.toLowerCase() ?? "",
        content: attributes.get("content") ?? "",
        raw:
          Number.isInteger(location?.startOffset)
          && Number.isInteger(location?.endOffset)
            ? source.slice(location.startOffset, location.endOffset)
            : "",
        location,
        path: `${managedParentPath}/meta[name=${
          attributes.get("name")?.toLowerCase() ?? ""
        }]`,
      });
      return null;
    }

    const node = {
      internalId: `node_${nextNodeOrdinal}`,
      type,
      original,
      parent,
      children: [],
      source,
      location: sourceLocation(original),
      path: "",
      attributes: attributesFor(original),
      rawAttributes,
      tagName:
        type === "element" ? original.tagName.toLowerCase() : null,
      namespaceURI:
        type === "element" ? original.namespaceURI ?? null : null,
      value:
        type === "text" || type === "comment"
          ? original.value ?? original.data ?? ""
          : null,
      name: type === "doctype" ? original.name ?? "" : null,
      publicId: type === "doctype" ? original.publicId ?? "" : null,
      systemId: type === "doctype" ? original.systemId ?? "" : null,
      semanticHash: null,
    };
    nextNodeOrdinal += 1;
    node.path = buildPath(node, parent, siblingCounters);
    if (type === "element") elements.push(node);
    if (type === "text") textNodes.push(node);

    const childCounters = new Map();
    for (const child of childNodesFor(original)) {
      const built = visit(child, node, childCounters, node.path);
      if (built) node.children.push(built);
    }
    return node;
  };

  const root = visit(document, null, new Map());
  const calculateSemanticHash = (node) => {
    const value = {
      node: semanticValueForNode(node),
      children: node.children.map(calculateSemanticHash),
    };
    node.semanticHash = digest(JSON.stringify(value));
    return node.semanticHash;
  };
  calculateSemanticHash(root);
  return {
    source,
    document,
    root,
    elements,
    textNodes,
    managedMetadata,
  };
}

function rawSlice(node, location = node?.location) {
  if (
    !node
    || !Number.isInteger(location?.startOffset)
    || !Number.isInteger(location?.endOffset)
  ) {
    return "";
  }
  return sourceSlice(node.source, location);
}

function locationFor(node, location = node?.location, suffix = "") {
  if (
    !node
    || !Number.isInteger(location?.startOffset)
    || !Number.isInteger(location?.endOffset)
    || !Number.isInteger(location?.startLine)
    || !Number.isInteger(location?.startCol)
    || !Number.isInteger(location?.endLine)
    || !Number.isInteger(location?.endCol)
  ) {
    return null;
  }
  return {
    path: `${node.path}${suffix}`,
    startOffset: location.startOffset,
    endOffset: location.endOffset,
    startLine: location.startLine,
    startColumn: location.startCol,
    endLine: location.endLine,
    endColumn: location.endCol,
  };
}

function metadataLocation(record) {
  const location = record?.location;
  if (
    !Number.isInteger(location?.startOffset)
    || !Number.isInteger(location?.endOffset)
    || !Number.isInteger(location?.startLine)
    || !Number.isInteger(location?.startCol)
    || !Number.isInteger(location?.endLine)
    || !Number.isInteger(location?.endCol)
  ) {
    return null;
  }
  return {
    path: record.path,
    startOffset: location.startOffset,
    endOffset: location.endOffset,
    startLine: location.startLine,
    startColumn: location.startCol,
    endLine: location.endLine,
    endColumn: location.endCol,
  };
}

function shallowPairScore(left, right) {
  if (left.type !== right.type) return Number.NEGATIVE_INFINITY;
  if (left.semanticHash === right.semanticHash) return 1_000;
  if (left.type === "element") {
    if (left.tagName !== right.tagName) return Number.NEGATIVE_INFINITY;
    const leftId = left.attributes.get("id");
    const rightId = right.attributes.get("id");
    if (leftId && leftId === rightId) return 900;
    const leftStable = [
      "data-html-ai-node-id",
      "data-node-id",
      "data-testid",
      "name",
    ].find(
      (name) =>
        left.attributes.has(name)
        && left.attributes.get(name) === right.attributes.get(name),
    );
    if (leftStable) return 700;
    return 90;
  }
  if (left.type === "doctype") return 200;
  if (left.type === "text") return 50;
  if (left.type === "comment") return 40;
  return 100;
}

function greedyAlignment(left, right) {
  const operations = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex >= left.length) {
      operations.push({ type: "insert", right: right[rightIndex] });
      rightIndex += 1;
      continue;
    }
    if (rightIndex >= right.length) {
      operations.push({ type: "delete", left: left[leftIndex] });
      leftIndex += 1;
      continue;
    }
    const pairScore = shallowPairScore(left[leftIndex], right[rightIndex]);
    if (Number.isFinite(pairScore)) {
      operations.push({
        type: "pair",
        left: left[leftIndex],
        right: right[rightIndex],
      });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    const rightLookahead = right
      .slice(rightIndex + 1, rightIndex + 9)
      .findIndex(
        (candidate) =>
          candidate.semanticHash === left[leftIndex].semanticHash,
      );
    const leftLookahead = left
      .slice(leftIndex + 1, leftIndex + 9)
      .findIndex(
        (candidate) =>
          candidate.semanticHash === right[rightIndex].semanticHash,
      );
    if (rightLookahead >= 0 && (
      leftLookahead < 0 || rightLookahead <= leftLookahead
    )) {
      operations.push({ type: "insert", right: right[rightIndex] });
      rightIndex += 1;
    } else {
      operations.push({ type: "delete", left: left[leftIndex] });
      leftIndex += 1;
    }
  }
  return operations;
}

function alignChildren(left, right) {
  if (left.length * right.length > MAX_ALIGNMENT_CELLS) {
    return greedyAlignment(left, right);
  }
  const width = right.length + 1;
  const directions = new Uint8Array((left.length + 1) * width);
  let previous = new Float64Array(width);
  let current = new Float64Array(width);
  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    previous[rightIndex] = rightIndex * GAP_PENALTY;
    directions[rightIndex] = 3;
  }

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex * GAP_PENALTY;
    directions[leftIndex * width] = 2;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const pairScore = shallowPairScore(
        left[leftIndex - 1],
        right[rightIndex - 1],
      );
      const diagonal = Number.isFinite(pairScore)
        ? previous[rightIndex - 1] + pairScore
        : Number.NEGATIVE_INFINITY;
      const deletion = previous[rightIndex] + GAP_PENALTY;
      const insertion = current[rightIndex - 1] + GAP_PENALTY;
      const index = leftIndex * width + rightIndex;
      if (diagonal >= deletion && diagonal >= insertion) {
        current[rightIndex] = diagonal;
        directions[index] = 1;
      } else if (deletion >= insertion) {
        current[rightIndex] = deletion;
        directions[index] = 2;
      } else {
        current[rightIndex] = insertion;
        directions[index] = 3;
      }
    }
    [previous, current] = [current, previous];
  }

  const reversed = [];
  let leftIndex = left.length;
  let rightIndex = right.length;
  while (leftIndex > 0 || rightIndex > 0) {
    const direction = directions[leftIndex * width + rightIndex];
    if (direction === 1) {
      reversed.push({
        type: "pair",
        left: left[leftIndex - 1],
        right: right[rightIndex - 1],
      });
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (direction === 2 || rightIndex === 0) {
      reversed.push({ type: "delete", left: left[leftIndex - 1] });
      leftIndex -= 1;
    } else {
      reversed.push({ type: "insert", right: right[rightIndex - 1] });
      rightIndex -= 1;
    }
  }
  return reversed.reverse();
}

function closestSpecialAncestor(node) {
  let cursor = node;
  while (cursor) {
    if (
      cursor.type === "element"
      && ["style", "script"].includes(cursor.tagName)
    ) {
      return cursor.tagName;
    }
    cursor = cursor.parent;
  }
  return null;
}

function isStylesheetLink(node) {
  return (
    node?.type === "element"
    && node.tagName === "link"
    && (node.attributes.get("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .includes("stylesheet")
  );
}

function kindForNode(node) {
  const special = closestSpecialAncestor(node);
  if (special === "style" || isStylesheetLink(node)) return "shared-css";
  if (special === "script") return "script";
  if (node?.type === "text") return "text";
  return "structure";
}

function kindForAttribute(node, attributeName) {
  const normalized = attributeName.toLowerCase();
  if (
    closestSpecialAncestor(node) === "style"
    || isStylesheetLink(node)
  ) {
    return "shared-css";
  }
  if (
    closestSpecialAncestor(node) === "script"
    || normalized.startsWith("on")
  ) {
    return "script";
  }
  if (normalized === "style") return "inline-style";
  return "attribute";
}

function nodeSemanticPreview(node) {
  if (!node) return "";
  if (node.type === "element") {
    return rawSlice(node).slice(0, MAX_PREVIEW_LENGTH);
  }
  if (node.type === "doctype") {
    return rawSlice(node) || `<!doctype ${node.name}>`;
  }
  return String(node.value ?? "");
}

function newInternalDifference(fields) {
  return {
    kind: fields.kind,
    operation: fields.operation,
    attributeName: fields.attributeName ?? null,
    baseLocation: fields.baseLocation ?? null,
    outputLocation: fields.outputLocation ?? null,
    before: fields.before ?? null,
    after: fields.after ?? null,
    _baseNode: fields.baseNode ?? null,
    _outputNode: fields.outputNode ?? null,
    _baseParent: fields.baseParent ?? fields.baseNode?.parent ?? null,
    _outputParent: fields.outputParent ?? fields.outputNode?.parent ?? null,
    _invalidManagedMetadata: fields.invalidManagedMetadata === true,
  };
}

function compareTrees(baseTree, outputTree) {
  const differences = [];
  const baseToOutput = new Map();
  const outputToBase = new Map();

  const compareNode = (baseNode, outputNode) => {
    baseToOutput.set(baseNode, outputNode);
    outputToBase.set(outputNode, baseNode);

    if (baseNode.type === "element") {
      const baseAttributeValues = attributeValuesByName(baseNode);
      const outputAttributeValues = attributeValuesByName(outputNode);
      const attributeNames = new Set([
        ...baseAttributeValues.keys(),
        ...outputAttributeValues.keys(),
      ]);
      let attributeChanged = false;
      for (const name of [...attributeNames].sort()) {
        // Duplicate attributes are order-sensitive: parsers use the first
        // occurrence, so reordering identical names can change behavior.
        const beforeValues = [...(baseAttributeValues.get(name) ?? [])];
        const afterValues = [...(outputAttributeValues.get(name) ?? [])];
        const hadBefore = beforeValues.length > 0;
        const hasAfter = afterValues.length > 0;
        if (JSON.stringify(beforeValues) === JSON.stringify(afterValues)) {
          continue;
        }
        attributeChanged = true;
        const baseAttributeLocation =
          baseNode.location?.attrs?.[name]
          ?? baseNode.location?.startTag
          ?? null;
        const outputAttributeLocation =
          outputNode.location?.attrs?.[name]
          ?? outputNode.location?.startTag
          ?? null;
        differences.push(
          newInternalDifference({
            kind: kindForAttribute(baseNode, name),
            operation:
              !hadBefore ? "add" : !hasAfter ? "remove" : "modify",
            attributeName: name,
            baseNode,
            outputNode,
            baseLocation: hadBefore
              ? locationFor(baseNode, baseAttributeLocation, `/@${name}`)
              : null,
            outputLocation: hasAfter
              ? locationFor(outputNode, outputAttributeLocation, `/@${name}`)
              : null,
            before: hadBefore ? evidence(beforeValues) : null,
            after: hasAfter ? evidence(afterValues) : null,
          }),
        );
      }
      if (!attributeChanged) {
        const baseStart = baseNode.location?.startTag;
        const outputStart = outputNode.location?.startTag;
        const before = rawSlice(baseNode, baseStart);
        const after = rawSlice(outputNode, outputStart);
        if (before && after && before !== after) {
          differences.push(
            newInternalDifference({
              kind: "semantic-normalization",
              operation: "normalize",
              baseNode,
              outputNode,
              baseLocation: locationFor(baseNode, baseStart, "/#start-tag"),
              outputLocation:
                locationFor(outputNode, outputStart, "/#start-tag"),
              before: evidence(before),
              after: evidence(after),
            }),
          );
        }
      }
      const baseEnd = baseNode.location?.endTag;
      const outputEnd = outputNode.location?.endTag;
      const beforeEnd = rawSlice(baseNode, baseEnd);
      const afterEnd = rawSlice(outputNode, outputEnd);
      if (beforeEnd && afterEnd && beforeEnd !== afterEnd) {
        differences.push(
          newInternalDifference({
            kind: "semantic-normalization",
            operation: "normalize",
            baseNode,
            outputNode,
            baseLocation: locationFor(baseNode, baseEnd, "/#end-tag"),
            outputLocation: locationFor(outputNode, outputEnd, "/#end-tag"),
            before: evidence(beforeEnd),
            after: evidence(afterEnd),
          }),
        );
      }
    } else if (
      baseNode.type === "text"
      || baseNode.type === "comment"
    ) {
      if (baseNode.value !== outputNode.value) {
        differences.push(
          newInternalDifference({
            kind:
              baseNode.type === "text"
                ? kindForNode(baseNode)
                : "structure",
            operation: "modify",
            baseNode,
            outputNode,
            baseLocation: locationFor(baseNode),
            outputLocation: locationFor(outputNode),
            before: evidence(baseNode.value),
            after: evidence(outputNode.value),
          }),
        );
      } else {
        const before = rawSlice(baseNode);
        const after = rawSlice(outputNode);
        if (before && after && before !== after) {
          differences.push(
            newInternalDifference({
              kind: "semantic-normalization",
              operation: "normalize",
              baseNode,
              outputNode,
              baseLocation: locationFor(baseNode),
              outputLocation: locationFor(outputNode),
              before: evidence(before),
              after: evidence(after),
            }),
          );
        }
      }
    } else if (baseNode.type === "doctype") {
      const beforeSemantic = semanticValueForNode(baseNode);
      const afterSemantic = semanticValueForNode(outputNode);
      if (JSON.stringify(beforeSemantic) !== JSON.stringify(afterSemantic)) {
        differences.push(
          newInternalDifference({
            kind: "structure",
            operation: "modify",
            baseNode,
            outputNode,
            baseLocation: locationFor(baseNode),
            outputLocation: locationFor(outputNode),
            before: evidence(beforeSemantic),
            after: evidence(afterSemantic),
          }),
        );
      } else if (rawSlice(baseNode) !== rawSlice(outputNode)) {
        differences.push(
          newInternalDifference({
            kind: "semantic-normalization",
            operation: "normalize",
            baseNode,
            outputNode,
            baseLocation: locationFor(baseNode),
            outputLocation: locationFor(outputNode),
            before: evidence(rawSlice(baseNode)),
            after: evidence(rawSlice(outputNode)),
          }),
        );
      }
    }

    for (const operation of alignChildren(
      baseNode.children,
      outputNode.children,
    )) {
      if (operation.type === "pair") {
        compareNode(operation.left, operation.right);
      } else if (operation.type === "delete") {
        differences.push(
          newInternalDifference({
            kind: kindForNode(operation.left),
            operation: "remove",
            baseNode: operation.left,
            baseParent: baseNode,
            outputParent: outputNode,
            baseLocation: locationFor(operation.left),
            before: evidence(nodeSemanticPreview(operation.left)),
          }),
        );
      } else {
        differences.push(
          newInternalDifference({
            kind: kindForNode(operation.right),
            operation: "add",
            outputNode: operation.right,
            baseParent: baseNode,
            outputParent: outputNode,
            outputLocation: locationFor(operation.right),
            after: evidence(nodeSemanticPreview(operation.right)),
          }),
        );
      }
    }
  };

  compareNode(baseTree.root, outputTree.root);
  return { differences, baseToOutput, outputToBase };
}

function splitSelectorGroups(selector) {
  const groups = [];
  let quote = null;
  let squareDepth = 0;
  let roundDepth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      squareDepth += 1;
    } else if (character === "]") {
      squareDepth -= 1;
    } else if (character === "(") {
      roundDepth += 1;
    } else if (character === ")") {
      roundDepth -= 1;
    } else if (
      character === ","
      && squareDepth === 0
      && roundDepth === 0
    ) {
      groups.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  groups.push(selector.slice(start).trim());
  if (
    quote
    || squareDepth !== 0
    || roundDepth !== 0
    || groups.some((group) => !group)
  ) {
    throw new Error("Malformed selector.");
  }
  return groups;
}

function readCssIdentifier(value, start) {
  let index = start;
  let result = "";
  while (index < value.length) {
    const character = value[index];
    if (character === "\\") {
      if (index + 1 >= value.length) throw new Error("Invalid CSS escape.");
      result += value[index + 1];
      index += 2;
      continue;
    }
    if (!/[A-Za-z0-9_-]/.test(character)) break;
    result += character;
    index += 1;
  }
  if (!result) throw new Error("Expected a CSS identifier.");
  return { value: result, end: index };
}

function readBalanced(value, start, opening, closing) {
  let quote = null;
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: value.slice(start + 1, index),
          end: index + 1,
        };
      }
    }
  }
  throw new Error("Unclosed selector expression.");
}

function parseAttributeSelector(content) {
  const match =
    /^([^\s~|^$*=\]]+)\s*(?:(~=|\|=|\^=|\$=|\*=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))\s*([isIS])?)?$/.exec(
      content.trim(),
    );
  if (!match) throw new Error("Unsupported attribute selector.");
  return {
    name: match[1].toLowerCase(),
    operator: match[2] ?? null,
    value: match[3] ?? match[4] ?? match[5] ?? null,
    caseInsensitive: match[6]?.toLowerCase() === "i",
  };
}

function parseCompoundSelector(value) {
  let index = 0;
  let tagName = "*";
  const tests = [];
  if (value[index] === "*") {
    index += 1;
  } else if (/[A-Za-z_-]/.test(value[index] ?? "")) {
    const identifier = readCssIdentifier(value, index);
    tagName = identifier.value.toLowerCase();
    index = identifier.end;
  }
  while (index < value.length) {
    const character = value[index];
    if (character === "#") {
      const identifier = readCssIdentifier(value, index + 1);
      tests.push({ type: "id", value: identifier.value });
      index = identifier.end;
    } else if (character === ".") {
      const identifier = readCssIdentifier(value, index + 1);
      tests.push({ type: "class", value: identifier.value });
      index = identifier.end;
    } else if (character === "[") {
      const balanced = readBalanced(value, index, "[", "]");
      tests.push({
        type: "attribute",
        value: parseAttributeSelector(balanced.content),
      });
      index = balanced.end;
    } else if (character === ":") {
      if (value[index + 1] === ":") {
        throw new Error("Pseudo-elements are not targetable.");
      }
      const identifier = readCssIdentifier(value, index + 1);
      const name = identifier.value.toLowerCase();
      index = identifier.end;
      let argument = null;
      if (value[index] === "(") {
        const balanced = readBalanced(value, index, "(", ")");
        argument = balanced.content.trim();
        index = balanced.end;
      }
      const supported = new Set([
        "root",
        "empty",
        "first-child",
        "last-child",
        "only-child",
        "first-of-type",
        "last-of-type",
        "only-of-type",
        "nth-child",
        "nth-of-type",
        "not",
        "is",
        "where",
      ]);
      if (!supported.has(name)) {
        throw new Error(`Unsupported pseudo-class :${name}.`);
      }
      tests.push({ type: "pseudo", name, argument });
    } else {
      throw new Error(`Unsupported selector token ${character}.`);
    }
  }
  return { tagName, tests };
}

function parseSelectorGroup(group) {
  const compounds = [];
  const combinators = [];
  let current = "";
  let quote = null;
  let squareDepth = 0;
  let roundDepth = 0;
  let pendingCombinator = null;

  const flush = () => {
    const value = current.trim();
    if (!value) return false;
    compounds.push(parseCompoundSelector(value));
    if (compounds.length > 1) combinators.push(pendingCombinator ?? " ");
    current = "";
    pendingCombinator = null;
    return true;
  };

  for (let index = 0; index < group.length; index += 1) {
    const character = group[index];
    if (quote) {
      current += character;
      if (character === "\\") {
        current += group[index + 1] ?? "";
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[") squareDepth += 1;
    if (character === "]") squareDepth -= 1;
    if (character === "(") roundDepth += 1;
    if (character === ")") roundDepth -= 1;
    if (squareDepth > 0 || roundDepth > 0) {
      current += character;
      continue;
    }
    if ([">", "+", "~"].includes(character)) {
      flush();
      pendingCombinator = character;
      continue;
    }
    if (/\s/.test(character)) {
      const hadCompound = flush();
      if (
        hadCompound
        && pendingCombinator === null
        && compounds.length > 0
      ) {
        pendingCombinator = " ";
      }
      continue;
    }
    current += character;
  }
  flush();
  if (compounds.length === 0 || combinators.length !== compounds.length - 1) {
    throw new Error("Malformed selector combinators.");
  }
  return { compounds, combinators };
}

function elementChildren(node) {
  return (node?.children ?? []).filter((child) => child.type === "element");
}

function previousElementSibling(node) {
  const siblings = elementChildren(node.parent);
  const index = siblings.indexOf(node);
  return index > 0 ? siblings[index - 1] : null;
}

function nthMatches(index, expression) {
  const normalized = expression.replace(/\s+/g, "").toLowerCase();
  if (normalized === "odd") return index % 2 === 1;
  if (normalized === "even") return index % 2 === 0;
  if (/^[+-]?\d+$/.test(normalized)) {
    return index === Number.parseInt(normalized, 10);
  }
  const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(normalized);
  if (!match) throw new Error("Unsupported nth expression.");
  const a =
    match[1] === "" || match[1] === "+"
      ? 1
      : match[1] === "-"
        ? -1
        : Number.parseInt(match[1], 10);
  const b = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (a === 0) return index === b;
  const quotient = (index - b) / a;
  return Number.isInteger(quotient) && quotient >= 0;
}

function attributeSelectorMatches(node, selector) {
  if (!node.attributes.has(selector.name)) return false;
  if (!selector.operator) return true;
  let actual = node.attributes.get(selector.name) ?? "";
  let expected = selector.value ?? "";
  if (selector.caseInsensitive) {
    actual = actual.toLowerCase();
    expected = expected.toLowerCase();
  }
  switch (selector.operator) {
    case "=":
      return actual === expected;
    case "~=":
      return actual.split(/\s+/).includes(expected);
    case "|=":
      return actual === expected || actual.startsWith(`${expected}-`);
    case "^=":
      return actual.startsWith(expected);
    case "$=":
      return actual.endsWith(expected);
    case "*=":
      return actual.includes(expected);
    default:
      return false;
  }
}

function compoundMatches(node, compound) {
  if (node?.type !== "element") return false;
  if (compound.tagName !== "*" && node.tagName !== compound.tagName) {
    return false;
  }
  for (const test of compound.tests) {
    if (test.type === "id") {
      if (node.attributes.get("id") !== test.value) return false;
    } else if (test.type === "class") {
      if (
        !(node.attributes.get("class") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .includes(test.value)
      ) {
        return false;
      }
    } else if (test.type === "attribute") {
      if (!attributeSelectorMatches(node, test.value)) return false;
    } else if (test.type === "pseudo") {
      const siblings = elementChildren(node.parent);
      const siblingIndex = siblings.indexOf(node);
      const sameType = siblings.filter(
        (candidate) => candidate.tagName === node.tagName,
      );
      const typeIndex = sameType.indexOf(node);
      switch (test.name) {
        case "root":
          if (node.tagName !== "html") return false;
          break;
        case "empty":
          if (
            node.children.some(
              (child) =>
                child.type === "element"
                || child.type === "text" && child.value.length > 0,
            )
          ) {
            return false;
          }
          break;
        case "first-child":
          if (siblingIndex !== 0) return false;
          break;
        case "last-child":
          if (siblingIndex !== siblings.length - 1) return false;
          break;
        case "only-child":
          if (siblings.length !== 1) return false;
          break;
        case "first-of-type":
          if (typeIndex !== 0) return false;
          break;
        case "last-of-type":
          if (typeIndex !== sameType.length - 1) return false;
          break;
        case "only-of-type":
          if (sameType.length !== 1) return false;
          break;
        case "nth-child":
          if (!nthMatches(siblingIndex + 1, test.argument ?? "")) return false;
          break;
        case "nth-of-type":
          if (!nthMatches(typeIndex + 1, test.argument ?? "")) return false;
          break;
        case "not":
        case "is":
        case "where": {
          const nestedGroups = splitSelectorGroups(test.argument ?? "")
            .map(parseSelectorGroup);
          if (nestedGroups.some((group) => group.compounds.length !== 1)) {
            throw new Error(
              `:${test.name} only supports compound selectors.`,
            );
          }
          const nestedMatched = nestedGroups.some((group) =>
            compoundMatches(node, group.compounds[0])
          );
          if (test.name === "not" ? nestedMatched : !nestedMatched) {
            return false;
          }
          break;
        }
        default:
          return false;
      }
    }
  }
  return true;
}

function selectorGroupMatches(node, group) {
  const matchAt = (candidate, index) => {
    if (!compoundMatches(candidate, group.compounds[index])) return false;
    if (index === 0) return true;
    const combinator = group.combinators[index - 1];
    if (combinator === ">") {
      return matchAt(candidate.parent, index - 1);
    }
    if (combinator === "+") {
      return matchAt(previousElementSibling(candidate), index - 1);
    }
    if (combinator === "~") {
      let sibling = previousElementSibling(candidate);
      while (sibling) {
        if (matchAt(sibling, index - 1)) return true;
        sibling = previousElementSibling(sibling);
      }
      return false;
    }
    let ancestor = candidate.parent;
    while (ancestor) {
      if (matchAt(ancestor, index - 1)) return true;
      ancestor = ancestor.parent;
    }
    return false;
  };
  return matchAt(node, group.compounds.length - 1);
}

function querySelectorAll(tree, selector) {
  const groups = splitSelectorGroups(String(selector)).map(parseSelectorGroup);
  return tree.elements.filter((node) =>
    groups.some((group) => selectorGroupMatches(node, group))
  );
}

function nodeText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return node.children.map(nodeText).join("");
}

function normalizedText(value) {
  return String(value ?? "").replace(/[\t\n\f\r ]+/gu, " ").trim();
}

function stableFingerprintAttributes(node) {
  const valuesByName = attributeValuesByName(node);
  const result = {};
  for (const [name, values] of valuesByName) {
    if (
      values.length === 1
      && (
        STABLE_FINGERPRINT_ATTRIBUTE_NAMES.has(name)
        || name.startsWith("data-")
        || name.startsWith("aria-")
      )
    ) {
      result[name] = values[0];
    }
  }
  return result;
}

function fingerprintElementSignature(node) {
  const attributes = Object.entries(stableFingerprintAttributes(node))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(",");
  return attributes ? `${node.tagName}[${attributes}]` : node.tagName;
}

function ancestorFingerprint(node) {
  const result = [];
  let parent = node?.parent ?? null;
  while (parent && result.length < 6) {
    if (parent.type === "element") {
      result.push(fingerprintElementSignature(parent));
    }
    parent = parent.parent;
  }
  return result;
}

function stableFingerprintCandidateScore(node, target) {
  const fingerprint = target?.fingerprint;
  if (!fingerprint || typeof fingerprint !== "object") return null;
  const tagName = String(fingerprint.tagName ?? "").toLowerCase();
  if (tagName && node.tagName !== tagName) return null;

  const stableAttributes =
    fingerprint.stableAttributes
    && typeof fingerprint.stableAttributes === "object"
      ? fingerprint.stableAttributes
      : {};
  for (const [name, value] of Object.entries(stableAttributes)) {
    if (node.attributes.get(name.toLowerCase()) !== String(value)) {
      return null;
    }
  }

  let identityScore = 0;
  const stableEntries = Object.entries(stableAttributes);
  if (stableEntries.length > 0) {
    identityScore += stableEntries.some(([name]) => name === "id") ? 90 : 65;
    identityScore += Math.min(
      20,
      Math.max(0, stableEntries.length - 1) * 5,
    );
  }

  const targetText = normalizedText(target.textQuote ?? "");
  const candidateText = normalizedText(nodeText(node));
  if (targetText && candidateText === targetText) identityScore += 60;
  const prefix = normalizedText(fingerprint.textPrefix ?? "");
  const suffix = normalizedText(fingerprint.textSuffix ?? "");
  if (prefix && candidateText.startsWith(prefix)) identityScore += 24;
  if (suffix && candidateText.endsWith(suffix)) identityScore += 24;

  identityScore += matchingFingerprintPrefixCount(
    Array.isArray(fingerprint.ancestorFingerprint)
      ? fingerprint.ancestorFingerprint
      : [],
    ancestorFingerprint(node),
  ) * 7;
  return identityScore;
}

function resolveStalePositionalTarget(tree, target) {
  const scored = tree.elements
    .map((node) => ({
      node,
      identityScore: stableFingerprintCandidateScore(node, target),
    }))
    .filter(
      (candidate) =>
        candidate.identityScore !== null
        && candidate.identityScore >= 30,
    )
    .sort((left, right) => right.identityScore - left.identityScore);
  if (scored.length === 0) {
    return {
      status: "orphaned",
      node: null,
      reason:
        "A stale positional selector has no position-independent identity.",
    };
  }
  const top = scored[0];
  const tied = scored.filter(
    (candidate) => candidate.identityScore === top.identityScore,
  );
  return resolutionFromCandidates(
    tied.map((candidate) => candidate.node),
    false,
    "position-independent fingerprint",
  );
}

function sourceAnchorCandidates(
  tree,
  sourceAnchor,
  actualSha256,
  targetLevel = "module",
) {
  if (!sourceAnchor || typeof sourceAnchor !== "object") return [];
  if (
    sourceAnchor.sourceSha256
    && normalizedSha(sourceAnchor.sourceSha256) !== normalizedSha(actualSha256)
  ) {
    return [];
  }
  const startOffset = Number(sourceAnchor.startOffset);
  const endOffset = Number(sourceAnchor.endOffset);
  if (
    !Number.isInteger(startOffset)
    || !Number.isInteger(endOffset)
    || startOffset < 0
    || endOffset < startOffset
  ) {
    return [];
  }
  const candidates = targetLevel === "text"
    ? tree.textNodes
    : tree.elements;
  const exact = candidates.filter(
    (node) =>
      node.location?.startOffset === startOffset
      && node.location?.endOffset === endOffset,
  );
  if (exact.length > 0) return exact;
  if (targetLevel === "text") return [];
  return candidates
    .filter(
      (node) =>
        Number.isInteger(node.location?.startOffset)
        && Number.isInteger(node.location?.endOffset)
        && node.location.startOffset <= startOffset
        && node.location.endOffset >= endOffset,
    )
    .sort(
      (left, right) =>
        (left.location.endOffset - left.location.startOffset)
        - (right.location.endOffset - right.location.startOffset),
    )
    .slice(0, 1);
}

function fingerprintCandidates(tree, fingerprint) {
  if (!fingerprint || typeof fingerprint !== "object") return [];
  const tagName = String(fingerprint.tagName ?? "").toLowerCase();
  const stableAttributes =
    fingerprint.stableAttributes
    && typeof fingerprint.stableAttributes === "object"
      ? fingerprint.stableAttributes
      : {};
  const textPrefix = String(fingerprint.textPrefix ?? "");
  const textSuffix = String(fingerprint.textSuffix ?? "");
  return tree.elements.filter((node) => {
    if (tagName && node.tagName !== tagName) return false;
    for (const [name, value] of Object.entries(stableAttributes)) {
      if (node.attributes.get(name.toLowerCase()) !== String(value)) {
        return false;
      }
    }
    const text = nodeText(node);
    if (textPrefix && !text.startsWith(textPrefix)) return false;
    if (textSuffix && !text.endsWith(textSuffix)) return false;
    return true;
  });
}

function resolutionFromCandidates(candidates, exact, reasonPrefix) {
  if (candidates.length === 1) {
    return {
      status: exact ? "exact" : "rebound",
      node: candidates[0],
      reason: null,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      node: null,
      reason: `${reasonPrefix} matched ${candidates.length} nodes.`,
    };
  }
  return {
    status: "orphaned",
    node: null,
    reason: `${reasonPrefix} did not match a node.`,
  };
}

function directTextNodes(elements, textQuote) {
  return elements
    .flatMap((element) => element.children.filter((child) => child.type === "text"))
    .filter((node) => node.value === textQuote);
}

function resolveTextTarget(tree, target, actualSha256) {
  if (["ambiguous", "orphaned"].includes(target.resolution)) {
    return {
      status: target.resolution,
      node: null,
      reason: `The frozen target state is ${target.resolution}.`,
    };
  }
  if (typeof target.textQuote !== "string") {
    return {
      status: "orphaned",
      node: null,
      reason: "A text target requires an exact textQuote value.",
    };
  }
  const anchorCandidates = sourceAnchorCandidates(
    tree,
    target.sourceAnchor,
    actualSha256,
    "text",
  ).filter((node) => node.value === target.textQuote);
  if (anchorCandidates.length > 0) {
    return resolutionFromCandidates(
      anchorCandidates,
      true,
      "text sourceAnchor",
    );
  }

  if (target.selector) {
    try {
      const matches = directTextNodes(
        querySelectorAll(tree, target.selector),
        target.textQuote,
      );
      if (matches.length > 0) {
        return resolutionFromCandidates(
          matches,
          !target.sourceAnchor,
          `text selector ${target.selector}`,
        );
      }
    } catch (error) {
      return {
        status: "orphaned",
        node: null,
        reason:
          `Selector ${target.selector} is unsupported: ${
            error instanceof Error ? error.message : "invalid selector"
          }`,
      };
    }
  }

  const fingerprintMatches = fingerprintCandidates(tree, target.fingerprint);
  const fingerprintTextNodes = directTextNodes(
    fingerprintMatches,
    target.textQuote,
  );
  if (fingerprintTextNodes.length > 0) {
    return resolutionFromCandidates(
      fingerprintTextNodes,
      false,
      "text fingerprint",
    );
  }

  return resolutionFromCandidates(
    tree.textNodes.filter((node) => node.value === target.textQuote),
    false,
    "textQuote",
  );
}

function resolveRegularTarget(tree, target, actualSha256) {
  if (["ambiguous", "orphaned"].includes(target.resolution)) {
    return {
      status: target.resolution,
      node: null,
      reason: `The frozen target state is ${target.resolution}.`,
    };
  }
  const anchorCandidates = sourceAnchorCandidates(
    tree,
    target.sourceAnchor,
    actualSha256,
    target.level,
  );
  if (anchorCandidates.length === 1) {
    return resolutionFromCandidates(
      anchorCandidates,
      true,
      "sourceAnchor",
    );
  }
  if (anchorCandidates.length > 1) {
    return resolutionFromCandidates(
      anchorCandidates,
      true,
      "sourceAnchor",
    );
  }

  if (isStalePositionalTarget(target, actualSha256)) {
    return resolveStalePositionalTarget(tree, target);
  }

  const selector = target.selector;
  if (selector) {
    try {
      let candidates = querySelectorAll(tree, selector);
      if (target.textQuote) {
        candidates = candidates.filter((node) =>
          nodeText(node).includes(target.textQuote)
        );
      }
      if (candidates.length > 0) {
        return resolutionFromCandidates(
          candidates,
          !target.sourceAnchor,
          `selector ${selector}`,
        );
      }
    } catch (error) {
      return {
        status: "orphaned",
        node: null,
        reason:
          `Selector ${selector} is unsupported: ${
            error instanceof Error ? error.message : "invalid selector"
          }`,
      };
    }
  }

  const fingerprintMatches = fingerprintCandidates(tree, target.fingerprint);
  if (fingerprintMatches.length > 0) {
    return resolutionFromCandidates(
      fingerprintMatches,
      false,
      "fingerprint",
    );
  }
  if (target.textQuote) {
    const matches = tree.elements
      .filter((node) => nodeText(node).includes(target.textQuote))
      .sort((left, right) => nodeText(left).length - nodeText(right).length);
    if (matches.length === 1) {
      return resolutionFromCandidates(matches, false, "textQuote");
    }
    if (
      matches.length > 1
      && nodeText(matches[0]).length < nodeText(matches[1]).length
    ) {
      return resolutionFromCandidates(
        [matches[0]],
        false,
        "textQuote",
      );
    }
    if (matches.length > 1) {
      return resolutionFromCandidates(matches, false, "textQuote");
    }
  }
  return {
    status: "orphaned",
    node: null,
    reason: "No target locator matched an element.",
  };
}

function insertionBoundary(parent, offset) {
  if (
    !parent
    || !Number.isInteger(offset)
    || !Number.isInteger(parent.location?.startTag?.endOffset)
    || !Number.isInteger(parent.location?.endTag?.startOffset)
    || offset < parent.location.startTag.endOffset
    || offset > parent.location.endTag.startOffset
  ) {
    return null;
  }
  const childrenWithLocations = parent.children.filter(
    (child) =>
      Number.isInteger(child.location?.startOffset)
      && Number.isInteger(child.location?.endOffset),
  );
  const containingChild = childrenWithLocations.find(
    (child) =>
      child.location.startOffset < offset
      && child.location.endOffset > offset
      && !(child.type === "text" && /^\s*$/.test(child.value)),
  );
  if (containingChild) return null;
  const elementChildrenBefore = elementChildren(parent).filter(
    (child) =>
      Number.isInteger(child.location?.endOffset)
      && child.location.endOffset <= offset,
  );
  const previous = [...elementChildren(parent)]
    .reverse()
    .find(
      (child) =>
        Number.isInteger(child.location?.endOffset)
        && child.location.endOffset <= offset,
    ) ?? null;
  const next = elementChildren(parent).find(
    (child) =>
      Number.isInteger(child.location?.startOffset)
      && child.location.startOffset >= offset,
  ) ?? null;
  return {
    previous,
    next,
    index: elementChildrenBefore.length,
  };
}

function resolveInsertionTarget(tree, target, actualSha256) {
  const sourceAnchor = target.sourceAnchor;
  if (
    !sourceAnchor
    || sourceAnchor.startOffset !== sourceAnchor.endOffset
  ) {
    return {
      status: "orphaned",
      node: null,
      reason:
        "Insertion target requires a zero-width sourceAnchor.",
      insertion: null,
    };
  }
  const parentResolution = resolveRegularTarget(
    tree,
    {
      ...target,
      sourceAnchor: undefined,
      textQuote: undefined,
    },
    actualSha256,
  );
  if (!parentResolution.node) {
    return { ...parentResolution, insertion: null };
  }
  if (
    normalizedSha(sourceAnchor.sourceSha256)
    !== normalizedSha(actualSha256)
  ) {
    return {
      ...parentResolution,
      insertion: null,
    };
  }
  const insertion = insertionBoundary(
    parentResolution.node,
    sourceAnchor.startOffset,
  );
  if (!insertion) {
    return {
      status: "orphaned",
      node: null,
      reason:
        "Insertion sourceAnchor is not a child boundary of its parent.",
      insertion: null,
    };
  }
  return { ...parentResolution, insertion };
}

function resolveTarget(tree, target, actualSha256) {
  if (target.level === "insertion-point") {
    return resolveInsertionTarget(tree, target, actualSha256);
  }
  if (target.level === "text") {
    return resolveTextTarget(tree, target, actualSha256);
  }
  return resolveRegularTarget(tree, target, actualSha256);
}

function sanitizedTarget(target, resolution) {
  const result = {
    targetId: target.targetId,
    label: target.label,
    level: target.level,
  };
  for (const key of [
    "selector",
    "textQuote",
    "sourceAnchor",
    "fingerprint",
  ]) {
    if (target[key] !== undefined) result[key] = target[key];
  }
  result.resolution = resolution;
  return result;
}

function isDescendantOrSelf(node, ancestor) {
  let cursor = node;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
}

function closestSharedStyleNode(node) {
  let cursor = node;
  while (cursor) {
    if (
      cursor.type === "element"
      && (cursor.tagName === "style" || isStylesheetLink(cursor))
    ) {
      return cursor;
    }
    cursor = cursor.parent;
  }
  return null;
}

function insertionGapMatches(
  targetResolution,
  insertedNode,
  outputToBase,
) {
  const parent = targetResolution.output.node;
  if (!parent || insertedNode.parent !== parent) return false;
  const outputSiblings = parent.children;
  const outputIndex = outputSiblings.indexOf(insertedNode);
  if (outputIndex < 0) return false;
  const baseInsertion = targetResolution.base.insertion;
  if (!baseInsertion) return false;

  const previousOutput = baseInsertion.previous
    ? targetResolution.baseToOutput.get(baseInsertion.previous) ?? null
    : null;
  const nextOutput = baseInsertion.next
    ? targetResolution.baseToOutput.get(baseInsertion.next) ?? null
    : null;
  if (
    previousOutput
    && outputSiblings.indexOf(previousOutput) >= outputIndex
  ) {
    return false;
  }
  if (nextOutput && outputSiblings.indexOf(nextOutput) <= outputIndex) {
    return false;
  }
  if (previousOutput || nextOutput) return true;

  const elementSiblingsBefore = outputSiblings
    .slice(0, outputIndex)
    .filter(
      (node) =>
        node.type === "element"
        && outputToBase.has(node),
    ).length;
  return elementSiblingsBefore === baseInsertion.index;
}

function targetTopologyGuardIds(
  targetResolution,
  targetResolutions,
  outputToBase,
) {
  const guards = [];
  const baseParent = targetResolution.base.node?.parent ?? null;
  const outputParent = targetResolution.output.node?.parent ?? null;
  for (const guard of targetResolutions) {
    if (guard === targetResolution) continue;
    if (guard.target.level === "insertion-point") {
      if (
        targetResolution.output.node
        && insertionGapMatches(
          guard,
          targetResolution.output.node,
          outputToBase,
        )
      ) {
        guards.push(guard.target.targetId);
      }
      continue;
    }
    if (
      guard.base.node
      && guard.output.node
      && baseParent
      && outputParent
      && isDescendantOrSelf(baseParent, guard.base.node)
      && isDescendantOrSelf(outputParent, guard.output.node)
    ) {
      guards.push(guard.target.targetId);
    }
  }
  return guards;
}

function classifyDifferences(
  rawDifferences,
  targetResolutions,
  baseToOutput,
  outputToBase,
) {
  const results = [];
  const violationCodes = new Set();

  for (const targetResolution of targetResolutions) {
    targetResolution.baseToOutput = baseToOutput;
    const unresolved = [
      targetResolution.base,
      ...(targetResolution.deleted ? [] : [targetResolution.output]),
    ].find((side) => ["ambiguous", "orphaned"].includes(side.status));
    if (!unresolved) continue;
    const statusCode = unresolved.status.toUpperCase();
    violationCodes.add(`TARGET_${statusCode}`);
    results.push({
      kind: "target-resolution",
      operation: "modify",
      attributeName: null,
      baseLocation:
        targetResolution.base.node
          ? locationFor(targetResolution.base.node)
          : null,
      outputLocation:
        targetResolution.output.node
          ? locationFor(targetResolution.output.node)
          : null,
      before: evidence(targetResolution.base.status),
      after: evidence(targetResolution.output.status),
      classification: "unresolved-target",
      allowed: false,
      material: true,
      targetIds: [targetResolution.target.targetId],
    });
  }

  for (const targetResolution of targetResolutions) {
    const { target, base, output } = targetResolution;
    if (
      target.level === "insertion-point"
      || !base.node
      || !output.node
      || targetResolution.deleted
      || [base.status, output.status].some(
        (status) => ["ambiguous", "orphaned"].includes(status),
      )
    ) {
      continue;
    }
    const baseParent = base.node.parent;
    const outputParent = output.node.parent;
    if (!baseParent || !outputParent) continue;
    const mappedParent = baseToOutput.get(baseParent) ?? null;
    const parentChanged = mappedParent !== outputParent;
    const baseIndex = baseParent.children.indexOf(base.node);
    const outputIndex = outputParent.children.indexOf(output.node);
    const orderChanged = !parentChanged && baseIndex !== outputIndex;
    if (!parentChanged && !orderChanged) continue;
    const guardIds = targetTopologyGuardIds(
      targetResolution,
      targetResolutions,
      outputToBase,
    );
    const allowed = guardIds.length > 0;
    if (!allowed) violationCodes.add("TARGET_ROOT_TOPOLOGY_CHANGED");
    results.push({
      kind: "structure",
      operation: "move",
      attributeName: null,
      baseLocation: locationFor(base.node),
      outputLocation: locationFor(output.node),
      before: evidence({
        parentPath: baseParent.path,
        childIndex: baseIndex,
      }),
      after: evidence({
        parentPath: outputParent.path,
        childIndex: outputIndex,
      }),
      classification: allowed ? "target-inside" : "target-outside",
      allowed,
      material: true,
      targetIds: [target.targetId, ...guardIds],
    });
  }

  for (const difference of rawDifferences) {
    if (difference.kind === "semantic-normalization") {
      results.push({
        ...difference,
        classification: "semantic-equivalent",
        allowed: true,
        material: false,
        targetIds: [],
      });
      continue;
    }
    if (
      difference.kind === "finalizer-metadata"
      && difference._invalidManagedMetadata
    ) {
      violationCodes.add("OUTPUT_MANAGED_META_MISMATCH");
      results.push({
        ...difference,
        classification: "target-outside",
        allowed: false,
        material: true,
        targetIds: [],
      });
      continue;
    }
    if (difference.kind === "finalizer-metadata") {
      results.push({
        ...difference,
        classification: "finalizer-metadata",
        allowed: true,
        material: false,
        targetIds: [],
      });
      continue;
    }

    const baseSideExists = Boolean(difference._baseNode);
    const outputSideExists = Boolean(difference._outputNode);
    const matchingTargets = [];
    for (const targetResolution of targetResolutions) {
      const { target, base, output } = targetResolution;
      if (
        ["ambiguous", "orphaned"].includes(base.status)
        || (
          !targetResolution.deleted
          && ["ambiguous", "orphaned"].includes(output.status)
        )
      ) {
        continue;
      }
      if (target.level === "insertion-point") {
        if (
          difference.operation === "add"
          && difference._outputNode
          && insertionGapMatches(
            targetResolution,
            difference._outputNode,
            outputToBase,
          )
        ) {
          matchingTargets.push(target.targetId);
        }
        continue;
      }

      const baseInside =
        !baseSideExists
        || isDescendantOrSelf(difference._baseNode, base.node);
      const outputInside =
        !outputSideExists
        || isDescendantOrSelf(difference._outputNode, output.node);
      if (!baseInside || !outputInside) continue;
      if (difference.kind === "shared-css") {
        const baseShared = closestSharedStyleNode(
          difference._baseNode ?? difference._baseParent,
        );
        const outputShared = closestSharedStyleNode(
          difference._outputNode ?? difference._outputParent,
        );
        const directlyTargeted =
          (!baseShared || base.node === baseShared)
          && (!outputShared || output.node === outputShared);
        if (!directlyTargeted) continue;
      }
      matchingTargets.push(target.targetId);
    }
    const allowed = matchingTargets.length > 0;
    if (!allowed) {
      const code =
        difference.kind === "shared-css"
          ? "SHARED_CSS_OUTSIDE_TARGET"
          : difference.kind === "script"
            ? "SCRIPT_OUTSIDE_TARGET"
            : `TARGET_OUTSIDE_${difference.kind
                .replaceAll("-", "_")
                .toUpperCase()}`;
      violationCodes.add(code);
    }
    results.push({
      ...difference,
      classification: allowed ? "target-inside" : "target-outside",
      allowed,
      material: true,
      targetIds: matchingTargets,
    });
  }

  return { results, violationCodes: [...violationCodes].sort() };
}

function managedMetadataDifferences(
  baseTree,
  outputTree,
  expectedManagedMetadata,
) {
  const differences = [];
  const byName = (records) => {
    const result = new Map();
    for (const record of records) {
      const list = result.get(record.name) ?? [];
      list.push(record);
      result.set(record.name, list);
    }
    return result;
  };
  const baseByName = byName(baseTree.managedMetadata);
  const outputByName = byName(outputTree.managedMetadata);
  for (const name of MANAGED_META_NAMES) {
    const baseRecords = baseByName.get(name) ?? [];
    const outputRecords = outputByName.get(name) ?? [];
    const expected = expectedManagedMetadata?.[name];
    if (
      expectedManagedMetadata
      && (
        outputRecords.length !== 1
        || outputRecords[0].content !== expected
      )
    ) {
      differences.push(
        newInternalDifference({
          kind: "finalizer-metadata",
          operation: "modify",
          attributeName: name,
          baseLocation: metadataLocation(baseRecords[0] ?? null),
          outputLocation: metadataLocation(outputRecords[0] ?? null),
          before: evidence(baseRecords.map((record) => record.content)),
          after: evidence(outputRecords.map((record) => record.content)),
          invalidManagedMetadata: true,
        }),
      );
      continue;
    }
    const count = Math.max(baseRecords.length, outputRecords.length);
    for (let index = 0; index < count; index += 1) {
      const before = baseRecords[index] ?? null;
      const after = outputRecords[index] ?? null;
      if (
        before
        && after
        && before.content === after.content
        && before.raw === after.raw
        && before.path === after.path
      ) {
        continue;
      }
      differences.push(
        newInternalDifference({
          kind: "finalizer-metadata",
          operation:
            !before ? "add" : !after ? "remove" : "normalize",
          attributeName: name,
          baseLocation: metadataLocation(before),
          outputLocation: metadataLocation(after),
          before: before ? evidence(before.raw || before.content) : null,
          after: after ? evidence(after.raw || after.content) : null,
        }),
      );
    }
  }
  return differences;
}

function stripInternalFields(difference, index) {
  return {
    differenceId: `difference_${String(index + 1).padStart(4, "0")}`,
    kind: difference.kind,
    classification: difference.classification,
    operation: difference.operation,
    allowed: difference.allowed,
    material: difference.material,
    targetIds: [...new Set(difference.targetIds)].sort(),
    attributeName: difference.attributeName ?? null,
    baseLocation: difference.baseLocation ?? null,
    outputLocation: difference.outputLocation ?? null,
    before: difference.before ?? null,
    after: difference.after ?? null,
  };
}

function resolutionStatusForMappedNode(baseResolution, mappedNode) {
  if (!mappedNode) {
    return {
      status: "orphaned",
      node: null,
      reason: "The resolved base target was removed from output.",
      insertion: null,
    };
  }
  return {
    status: "rebound",
    node: mappedNode,
    reason: null,
    insertion: baseResolution.insertion
      ? {
          previous: baseResolution.insertion.previous
            ? null
            : null,
          next: baseResolution.insertion.next ? null : null,
          index: baseResolution.insertion.index,
        }
      : null,
  };
}

function combineTargetResolutions({
  targets,
  baseTree,
  outputTree,
  baseSha256,
  outputSha256,
  baseToOutput,
}) {
  return targets.map((target) => {
    const base = resolveTarget(baseTree, target, baseSha256);
    let output = resolveTarget(outputTree, target, outputSha256);
    const mapped = base.node ? baseToOutput.get(base.node) : null;
    if (
      base.node
      && mapped
      && ["ambiguous", "orphaned"].includes(output.status)
    ) {
      if (target.level === "insertion-point") {
        output = {
          status: "rebound",
          node: mapped,
          reason: null,
          insertion: {
            previous: base.insertion?.previous
              ? baseToOutput.get(base.insertion.previous) ?? null
              : null,
            next: base.insertion?.next
              ? baseToOutput.get(base.insertion.next) ?? null
              : null,
            index: base.insertion?.index ?? null,
          },
        };
      } else {
        output = resolutionStatusForMappedNode(base, mapped);
      }
    }
    const reason = [base.reason, output.reason].filter(Boolean).join(" ") || null;
    return {
      target,
      base,
      output,
      deleted:
        Boolean(base.node)
        && !mapped
        && output.status === "orphaned"
        && target.level !== "insertion-point",
      report: sanitizedTarget(target, {
        base: base.status,
        output: output.status,
        basePath: base.node?.path ?? null,
        outputPath: output.node?.path ?? null,
        reason,
      }),
    };
  });
}

export function targetsReferencedByRequest(changeRequest) {
  const requirements = changeRequest?.requirements ?? {};
  const targets = Array.isArray(requirements.targets)
    ? requirements.targets
    : [];
  const referencedIds = new Set(
    (requirements.instructions ?? [])
      .flatMap((instruction) =>
        Array.isArray(instruction?.targetRefs)
          ? instruction.targetRefs
          : []
      ),
  );
  const referenced = targets.filter((target) =>
    referencedIds.has(target.targetId)
  );
  return referenced.length > 0 ? referenced : targets;
}

export function validateScope({
  baseHtml,
  outputHtml,
  allowedTargets,
  projectId,
  documentId,
  requestId,
  attemptId,
  expectedManagedMetadata,
  generatedAt = new Date().toISOString(),
}) {
  const baseText = String(baseHtml);
  const outputText = String(outputHtml);
  const baseSha256 = sha256(Buffer.from(baseText, "utf8"));
  const outputSha256 = sha256(Buffer.from(outputText, "utf8"));
  const baseTree = buildTree(baseText);
  const outputTree = buildTree(outputText);
  const compared = compareTrees(baseTree, outputTree);
  const targetResolutions = combineTargetResolutions({
    targets: allowedTargets,
    baseTree,
    outputTree,
    baseSha256,
    outputSha256,
    baseToOutput: compared.baseToOutput,
  });
  const metadataDifferences = managedMetadataDifferences(
    baseTree,
    outputTree,
    expectedManagedMetadata,
  );
  const classified = classifyDifferences(
    [...metadataDifferences, ...compared.differences],
    targetResolutions,
    compared.baseToOutput,
    compared.outputToBase,
  );
  const differences = classified.results.map(stripInternalFields);
  const byKind = {};
  for (const difference of differences) {
    byKind[difference.kind] = (byKind[difference.kind] ?? 0) + 1;
  }
  const violationCount = differences.filter(
    (difference) => !difference.allowed,
  ).length;
  return {
    schemaVersion: SCOPE_REPORT_SCHEMA_VERSION,
    validatorVersion: SCOPE_VALIDATOR_VERSION,
    enforcementMode: SCOPE_ENFORCEMENT_MODE,
    projectId,
    documentId,
    requestId,
    attemptId,
    generatedAt,
    base: {
      sha256: baseSha256,
      comparisonSha256: comparisonSha256(baseText),
    },
    output: {
      sha256: outputSha256,
      comparisonSha256: comparisonSha256(outputText),
    },
    managedMetadataWhitelist: [...MANAGED_META_NAMES],
    allowedTargets: targetResolutions.map((item) => item.report),
    differences,
    summary: {
      differenceCount: differences.length,
      materialDifferenceCount: differences.filter(
        (difference) => difference.material,
      ).length,
      allowedDifferenceCount: differences.filter(
        (difference) => difference.allowed,
      ).length,
      violationCount,
      byKind,
    },
    verdict: violationCount === 0 ? "pass" : "fail",
    violationCodes: classified.violationCodes,
  };
}
