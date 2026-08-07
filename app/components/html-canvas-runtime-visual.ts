import type { RuntimeVisualProjection } from "../domain/runtime-visual-projection.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
} from "../lib/source-index.js";

export const RUNTIME_VISUAL_ATTRIBUTE = "data-pageroot-readonly-visual";
export const RUNTIME_VISUAL_HOST_ATTRIBUTE =
  "data-pageroot-readonly-visual-host";
export const RUNTIME_VISUAL_KEY_ATTRIBUTE =
  "data-pageroot-readonly-visual-key";

const pendingMountByHost = new WeakMap<HTMLElement, HTMLElement>();

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
    || (
      node.nodeType === 1
      && (node as Element).hasAttribute(RUNTIME_VISUAL_ATTRIBUTE)
    )
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
  setImportantStyle(image, "display", "block");
  setImportantStyle(image, "box-sizing", "border-box");
  setImportantStyle(image, "width", `${visual.layoutWidth}px`);
  setImportantStyle(image, "height", `${visual.layoutHeight}px`);
  setImportantStyle(image, "max-width", "none");
  setImportantStyle(image, "max-height", "none");
  setImportantStyle(image, "margin", "0");
  setImportantStyle(image, "padding", "0");
  setImportantStyle(image, "border", "0");
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

function createTableProjection(
  documentNode: Document,
  body: HTMLElement,
  image: HTMLImageElement,
): HTMLTableRowElement {
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
  return row;
}

function projectionRoots(documentNode: Document): HTMLElement[] {
  return Array.from(documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_KEY_ATTRIBUTE}]`,
  ));
}

function projectionImage(root: HTMLElement): HTMLImageElement | null {
  if (root.tagName === "IMG") return root as HTMLImageElement;
  return root.querySelector<HTMLImageElement>(
    `img[${RUNTIME_VISUAL_ATTRIBUTE}="runtime-bitmap"]`,
  );
}

function projectionHost(root: HTMLElement): HTMLElement | null {
  if (root.tagName === "TR") return root.parentElement;
  return root.parentElement;
}

function artifactMatches(
  root: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
): boolean {
  const image = projectionImage(root);
  return Boolean(
    image
    && root.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) === visual.captureKey
    && image.getAttribute("src") === visual.dataUrl
    && image.style.getPropertyValue("width") === `${visual.layoutWidth}px`
    && image.style.getPropertyValue("height") === `${visual.layoutHeight}px`,
  );
}

function createProjectionMount(
  documentNode: Document,
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
): { image: HTMLImageElement; root: HTMLElement } {
  const image = createProjectionImage(documentNode, visual);
  const root = visual.tagName === "tbody"
    ? createTableProjection(documentNode, host, image)
    : image;
  root.setAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE, visual.captureKey);
  return { image, root };
}

function stageProjectionMount(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
  existing: HTMLElement | null,
) {
  const documentNode = host.ownerDocument;
  const { image, root } = createProjectionMount(documentNode, host, visual);
  const previousPending = pendingMountByHost.get(host);
  if (previousPending && previousPending !== root) previousPending.remove();

  if (!existing) {
    host.append(root);
    image.src = visual.dataUrl;
    pendingMountByHost.delete(host);
    return;
  }

  setImportantStyle(root, "display", "none");
  host.append(root);
  pendingMountByHost.set(host, root);
  let settled = false;
  const commit = () => {
    if (
      settled
      || pendingMountByHost.get(host) !== root
      || !root.isConnected
    ) return;
    settled = true;
    existing.remove();
    root.style.setProperty(
      "display",
      visual.tagName === "tbody" ? "table-row" : "block",
      "important",
    );
    pendingMountByHost.delete(host);
  };
  const reject = () => {
    if (settled) return;
    settled = true;
    root.remove();
    if (pendingMountByHost.get(host) === root) pendingMountByHost.delete(host);
  };
  image.addEventListener("load", commit, { once: true });
  image.addEventListener("error", reject, { once: true });
  image.src = visual.dataUrl;
  if (image.complete && image.naturalWidth > 0) commit();
  else void image.decode?.().then(commit, () => undefined);
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
  if (!projection) {
    restoreRuntimeVisualProjection(documentNode);
    return 0;
  }
  let sourceIndex;
  try {
    sourceIndex = buildSourceIndex(sourceHtml);
  } catch {
    return projectionRoots(documentNode).length;
  }
  if (projection.sourceSha256 !== sourceIndex.sourceSha256) {
    return projectionRoots(documentNode).length;
  }

  const existingRoots = projectionRoots(documentNode);
  const acceptedKeys = new Set<string>();
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

    const hostRoots = existingRoots.filter((root) => (
      projectionHost(root) === element
      && root.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) === visual.captureKey
    ));
    const matching = hostRoots.find((root) => artifactMatches(root, visual)) ?? null;
    element.setAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE, "runtime-bitmap");
    acceptedKeys.add(visual.captureKey);
    if (!matching) {
      const existing = hostRoots[0]
        ?? existingRoots.find((root) => (
          root.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) === visual.captureKey
        ))
        ?? null;
      stageProjectionMount(element, visual, existing);
    }
    applied += 1;
  }

  for (const root of existingRoots) {
    const key = root.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) ?? "";
    if (!acceptedKeys.has(key)) root.remove();
  }
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_HOST_ATTRIBUTE}]`,
  ).forEach((element) => {
    const hasProjection = Array.from(element.children).some((child) => (
      child.hasAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE)
    ));
    if (!hasProjection) element.removeAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE);
  });
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_ATTRIBUTE}]:not([${RUNTIME_VISUAL_KEY_ATTRIBUTE}])`,
  ).forEach((element) => {
    if (!element.closest(`[${RUNTIME_VISUAL_KEY_ATTRIBUTE}]`)) element.remove();
  });
  return applied;
}
