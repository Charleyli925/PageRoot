import { createSourceOperationId } from "../domain/source-history.js";
import { buildSourceIndex } from "./source-index.js";
import {
  createSemanticElementPrecondition,
} from "./semantic-operation-kernel.js";

function sourceIndex(indexOrHtml) {
  return typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
}

function sourceElement(index, elementId, fieldName) {
  const element = index?.byPagerootId?.get(elementId) ?? null;
  if (!element || element.type !== "element") {
    throw new TypeError(`${fieldName} must identify one authored source element.`);
  }
  return element;
}

function envelope(index, baseRevision, operationId) {
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new TypeError("baseRevision must be a non-negative safe integer.");
  }
  return {
    schemaVersion: 1,
    operationId: operationId || createSourceOperationId(),
    baseRevision,
    expectedSourceSha256: index.sourceSha256,
  };
}

function directChild(index, parent, elementId, fieldName) {
  if (elementId === null || elementId === undefined) return null;
  const element = sourceElement(index, elementId, fieldName);
  if (element.parentId !== parent.nodeId) {
    throw new TypeError(`${fieldName} must be a direct child of the declared parent.`);
  }
  return element;
}

export function identityFreeSourceElementHtml(indexOrHtml, elementId) {
  const index = sourceIndex(indexOrHtml);
  const root = sourceElement(index, elementId, "elementId");
  const removals = index.elements
    .filter((element) => (
      element.range.startOffset >= root.range.startOffset
      && element.range.endOffset <= root.range.endOffset
      && element.pagerootIdAttribute
    ))
    .map((element) => element.pagerootIdAttribute.range)
    .sort((left, right) => right.startOffset - left.startOffset);
  let html = root.raw;
  for (const removal of removals) {
    const startOffset = removal.startOffset - root.range.startOffset;
    const endOffset = removal.endOffset - root.range.startOffset;
    html = `${html.slice(0, startOffset)}${html.slice(endOffset)}`;
  }
  return html;
}

export function createInsertElementOperation(indexOrHtml, options) {
  const index = sourceIndex(indexOrHtml);
  const parent = sourceElement(index, options.parentElementId, "parentElementId");
  const before = directChild(
    index,
    parent,
    options.beforeElementId ?? null,
    "beforeElementId",
  );
  if (typeof options.html !== "string" || options.html.length === 0) {
    throw new TypeError("html must contain one source element.");
  }
  return {
    ...envelope(index, options.baseRevision, options.operationId),
    type: "insertElement",
    parent: createSemanticElementPrecondition(index, parent.pagerootId),
    before: before
      ? createSemanticElementPrecondition(index, before.pagerootId)
      : null,
    html: options.html,
  };
}

export function createDuplicateElementOperation(indexOrHtml, options) {
  const index = sourceIndex(indexOrHtml);
  const target = sourceElement(index, options.elementId, "elementId");
  const parent = target.parentId ? index.byNodeId.get(target.parentId) : null;
  if (!parent || parent.type !== "element") {
    throw new TypeError("Only an authored element with a source parent can be duplicated.");
  }
  const next = target.nextElementSiblingId
    ? index.byNodeId.get(target.nextElementSiblingId)
    : null;
  return createInsertElementOperation(index, {
    baseRevision: options.baseRevision,
    operationId: options.operationId,
    parentElementId: parent.pagerootId,
    beforeElementId: next?.type === "element" ? next.pagerootId : null,
    html: identityFreeSourceElementHtml(index, target.pagerootId),
  });
}

export function createDeleteElementOperation(indexOrHtml, options) {
  const index = sourceIndex(indexOrHtml);
  const target = sourceElement(index, options.elementId, "elementId");
  if (!target.parentId || ["html", "head", "body"].includes(target.tagName)) {
    throw new TypeError("The document root and source containers cannot be deleted.");
  }
  return {
    ...envelope(index, options.baseRevision, options.operationId),
    type: "deleteElement",
    target: createSemanticElementPrecondition(index, target.pagerootId),
  };
}

export function createMoveElementOperation(indexOrHtml, options) {
  const index = sourceIndex(indexOrHtml);
  const target = sourceElement(index, options.elementId, "elementId");
  const parent = sourceElement(index, options.parentElementId, "parentElementId");
  const before = directChild(
    index,
    parent,
    options.beforeElementId ?? null,
    "beforeElementId",
  );
  if (!target.parentId || ["html", "head", "body"].includes(target.tagName)) {
    throw new TypeError("The document root and source containers cannot be moved.");
  }
  return {
    ...envelope(index, options.baseRevision, options.operationId),
    type: "moveElement",
    target: createSemanticElementPrecondition(index, target.pagerootId),
    parent: createSemanticElementPrecondition(index, parent.pagerootId),
    before: before
      ? createSemanticElementPrecondition(index, before.pagerootId)
      : null,
  };
}
