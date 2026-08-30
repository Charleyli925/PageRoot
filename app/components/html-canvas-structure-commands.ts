import { createTargetRef } from "../lib/source-patch-core.js";
import {
  createDeleteElementOperation,
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
} from "../lib/source-structure-edit.js";
import { selectionFromRefreshedTarget } from "./html-canvas-selection";
import type { SourceIndexValue, SourceTargetRef } from "./html-canvas-internal-types";
import type {
  HtmlCanvasMutation,
  HtmlCanvasSelection,
} from "./HtmlCanvasEditor.types";

export type SelectedStructureAction = "duplicate" | "delete" | "move";
export type StructureDestination = {
  parentElementId: string;
  beforeElementId?: string | null;
};

function sourceSelectionForElementId(
  sourceIndex: SourceIndexValue,
  elementId: string,
  original?: HtmlCanvasSelection | null,
): HtmlCanvasSelection {
  const element = sourceIndex.byPagerootId.get(elementId);
  if (!element || element.type !== "element") {
    throw new Error("源码元素已不存在，无法执行结构操作。");
  }
  const moduleTags = new Set(["article", "aside", "footer", "header", "main", "nav", "section"]);
  const level = original?.level === "module" || moduleTags.has(element.tagName)
    ? "module"
    : "part";
  const targetRef = createTargetRef(sourceIndex, element, {
    ...(original?.id ? { targetId: original.id } : {}),
    ...(original?.label ? { label: original.label } : {}),
    level: level === "module" ? "module" : "subregion",
  }) as SourceTargetRef;
  return selectionFromRefreshedTarget(
    original ?? {
      id: targetRef.targetId,
      label: targetRef.label,
      selector: targetRef.selector || element.selector,
      level,
      tagName: element.tagName,
      text: element.textContent,
      resolution: "exact",
    },
    targetRef,
    element.nodeId,
  );
}

export function selectedStructureCommand(options: {
  sourceIndex: SourceIndexValue;
  selection: HtmlCanvasSelection;
  action: SelectedStructureAction;
  destination?: StructureDestination;
  baseRevision: number;
}) {
  const { sourceIndex, selection, action, destination, baseRevision } = options;
  if (!selection.elementId || selection.level === "insertion") {
    throw new Error("只能修改具有稳定 ID 的源码元素。");
  }
  if (["html", "head", "body"].includes(selection.tagName)) {
    throw new Error("文档根和源码容器不能执行这个结构操作。");
  }
  const operation = action === "duplicate"
    ? createDuplicateElementOperation(sourceIndex, {
      baseRevision,
      elementId: selection.elementId,
    })
    : action === "delete"
      ? createDeleteElementOperation(sourceIndex, {
        baseRevision,
        elementId: selection.elementId,
      })
      : createMoveElementOperation(sourceIndex, {
        baseRevision,
        elementId: selection.elementId,
        parentElementId: destination?.parentElementId || "",
        beforeElementId: destination?.beforeElementId ?? null,
      });
  const mutation: HtmlCanvasMutation = {
    kind: "structure",
    target: selection,
    property: action,
    before: { elementId: selection.elementId, selector: selection.selector },
    after: action === "delete"
      ? null
      : { elementId: selection.elementId, ...(destination || {}) },
  };
  return { operation, mutation };
}

export function insertStructureCommand(options: {
  sourceIndex: SourceIndexValue;
  originalSelection?: HtmlCanvasSelection | null;
  parentElementId: string;
  beforeElementId?: string | null;
  html: string;
  baseRevision: number;
}) {
  const parentSelection = sourceSelectionForElementId(
    options.sourceIndex,
    options.parentElementId,
    options.originalSelection?.elementId === options.parentElementId
      ? options.originalSelection
      : null,
  );
  return {
    operation: createInsertElementOperation(options.sourceIndex, {
      baseRevision: options.baseRevision,
      parentElementId: options.parentElementId,
      beforeElementId: options.beforeElementId ?? null,
      html: options.html,
    }),
    mutation: {
      kind: "structure",
      target: parentSelection,
      property: "insert",
      before: null,
      after: {
        parentElementId: options.parentElementId,
        beforeElementId: options.beforeElementId ?? null,
      },
    } satisfies HtmlCanvasMutation,
  };
}
