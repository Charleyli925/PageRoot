import { createSourceOperationId } from "../domain/source-history.js";
import { createSemanticElementPrecondition } from "../lib/semantic-operation-kernel.js";
import { createMoveElementOperation } from "../lib/source-structure-edit.js";

// Canvas intent only. The kernel still validates and materializes each operation.
export function inlineStyleOperation(sourceIndex, options) {
  return {
    schemaVersion: 1,
    operationId: options.operationId || createSourceOperationId(),
    baseRevision: options.baseRevision,
    expectedSourceSha256: sourceIndex.sourceSha256,
    type: "setStyle",
    target: createSemanticElementPrecondition(sourceIndex, options.elementId),
    property: options.property,
    value: options.value,
    important: options.important,
  };
}

export function siblingReorderOperation(sourceIndex, options) {
  const target = sourceIndex.byPagerootId.get(options.elementId);
  const parent = target?.parentId
    ? sourceIndex.byNodeId.get(target.parentId)
    : null;
  if (target?.type !== "element" || parent?.type !== "element") {
    throw new Error("语义排序需要稳定源码父元素。");
  }
  const remaining = parent.childElementIds.filter((nodeId) => nodeId !== target.nodeId);
  if (!Number.isSafeInteger(options.toIndex) || options.toIndex < 0 || options.toIndex > remaining.length) {
    throw new Error("语义排序目标位置无效。");
  }
  const before = sourceIndex.byNodeId.get(remaining[options.toIndex]);
  return createMoveElementOperation(sourceIndex, {
    baseRevision: options.baseRevision,
    operationId: options.operationId,
    elementId: options.elementId,
    parentElementId: parent.pagerootId,
    beforeElementId: before?.pagerootId ?? null,
  });
}
