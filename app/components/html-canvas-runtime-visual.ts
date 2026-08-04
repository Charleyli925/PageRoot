import type { RuntimeVisualProjection } from "../domain/runtime-visual-projection.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
} from "../lib/source-index.js";

export const RUNTIME_VISUAL_ATTRIBUTE = "data-pageroot-readonly-visual";
export const RUNTIME_VISUAL_HOST_ATTRIBUTE =
  "data-pageroot-readonly-visual-host";

function escapedAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function uniqueSourceElement(
  documentNode: Document,
  sourceNodeId: string,
): HTMLElement | null {
  const matches = documentNode.querySelectorAll<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}="${escapedAttributeValue(sourceNodeId)}"]`,
  );
  return matches.length === 1 ? matches[0] : null;
}

function authoredContentIsEmpty(element: HTMLElement): boolean {
  return Array.from(element.childNodes).every((node) => (
    node.nodeType === 8
    || (node.nodeType === 3 && !(node.textContent ?? "").trim())
  ));
}

function setImportantStyle(
  element: HTMLElement,
  property: string,
  value: string,
) {
  element.style.setProperty(property, value, "important");
}

function createProjectionImage(
  documentNode: Document,
  visual: RuntimeVisualProjection["visuals"][number],
): HTMLImageElement {
  const image = documentNode.createElement("img");
  image.setAttribute(RUNTIME_VISUAL_ATTRIBUTE, "runtime-bitmap");
  image.setAttribute("contenteditable", "false");
  image.setAttribute("aria-hidden", "true");
  image.setAttribute("alt", "");
  image.setAttribute("draggable", "false");
  image.width = visual.width;
  image.height = visual.height;
  image.src = visual.dataUrl;
  setImportantStyle(image, "display", "block");
  setImportantStyle(image, "box-sizing", "border-box");
  setImportantStyle(image, "width", `${visual.layoutWidth}px`);
  setImportantStyle(image, "height", `${visual.layoutHeight}px`);
  setImportantStyle(image, "max-width", "none");
  setImportantStyle(image, "max-height", "none");
  setImportantStyle(image, "margin", "0");
  setImportantStyle(image, "padding", "0");
  setImportantStyle(image, "border", "0");
  setImportantStyle(image, "object-fit", "fill");
  setImportantStyle(image, "pointer-events", "none");
  setImportantStyle(image, "user-select", "none");
  return image;
}

function tableColumnCount(body: HTMLElement): number {
  const table = body.closest("table");
  const authoredRow = table?.querySelector(
    `tr:not([${RUNTIME_VISUAL_ATTRIBUTE}])`,
  );
  if (!authoredRow) return 1;
  return Math.max(
    1,
    Array.from(authoredRow.children).reduce((count, cell) => (
      count + Math.max(1, Number.parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1)
    ), 0),
  );
}

function appendTableProjection(
  documentNode: Document,
  body: HTMLElement,
  image: HTMLImageElement,
) {
  const row = documentNode.createElement("tr");
  row.setAttribute(RUNTIME_VISUAL_ATTRIBUTE, "runtime-bitmap-row");
  row.setAttribute("contenteditable", "false");
  setImportantStyle(row, "display", "table-row");
  setImportantStyle(row, "height", "auto");
  setImportantStyle(row, "margin", "0");
  setImportantStyle(row, "padding", "0");
  setImportantStyle(row, "border", "0");
  setImportantStyle(row, "background", "transparent");
  setImportantStyle(row, "pointer-events", "none");

  const cell = documentNode.createElement("td");
  cell.colSpan = tableColumnCount(body);
  cell.setAttribute(RUNTIME_VISUAL_ATTRIBUTE, "runtime-bitmap-cell");
  cell.setAttribute("contenteditable", "false");
  setImportantStyle(cell, "display", "table-cell");
  setImportantStyle(cell, "width", "auto");
  setImportantStyle(cell, "height", "auto");
  setImportantStyle(cell, "margin", "0");
  setImportantStyle(cell, "padding", "0");
  setImportantStyle(cell, "border", "0");
  setImportantStyle(cell, "background", "transparent");
  setImportantStyle(cell, "line-height", "0");
  setImportantStyle(cell, "pointer-events", "none");
  cell.append(image);
  row.append(cell);
  body.append(row);
}

export function restoreRuntimeVisualProjection(documentNode: Document) {
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_ATTRIBUTE}]`,
  ).forEach((element) => element.remove());
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_HOST_ATTRIBUTE}]`,
  ).forEach((element) => (
    element.removeAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE)
  ));
}

export function applyRuntimeVisualProjectionToDocument(
  documentNode: Document,
  sourceHtml: string,
  projection: RuntimeVisualProjection | null,
): number {
  restoreRuntimeVisualProjection(documentNode);
  if (!projection) return 0;
  let sourceIndex;
  try {
    sourceIndex = buildSourceIndex(sourceHtml);
  } catch {
    return 0;
  }
  if (projection.sourceSha256 !== sourceIndex.sourceSha256) return 0;

  let applied = 0;
  for (const visual of projection.visuals) {
    const sourceElement = sourceIndex.byNodeId.get(visual.sourceNodeId);
    const element = uniqueSourceElement(documentNode, visual.sourceNodeId);
    if (
      sourceElement?.type !== "element"
      || sourceElement.tagName !== visual.tagName
      || !element
      || element.tagName.toLowerCase() !== visual.tagName
      || !authoredContentIsEmpty(element)
    ) continue;
    const image = createProjectionImage(documentNode, visual);
    element.setAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE, "runtime-bitmap");
    if (visual.tagName === "tbody") {
      appendTableProjection(documentNode, element, image);
    } else {
      element.append(image);
    }
    applied += 1;
  }
  return applied;
}
