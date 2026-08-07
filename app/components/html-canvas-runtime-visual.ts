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
const RUNTIME_VISUAL_LAYOUT_ATTRIBUTE =
  "data-pageroot-readonly-visual-layout";
const RUNTIME_VISUAL_CONTENT_SHA_ATTRIBUTE =
  "data-pageroot-readonly-visual-content-sha";

const pendingMountByHost = new WeakMap<HTMLElement, HTMLElement>();
const pendingHosts = new Set<HTMLElement>();
const resizeObserverByHost = new WeakMap<HTMLElement, ResizeObserver>();
const observedRootByHost = new WeakMap<HTMLElement, HTMLElement>();
const objectUrlByImage = new WeakMap<HTMLImageElement, string>();
const backgroundProjectionByHost = new WeakMap<HTMLElement, {
  runtimeContentSha256: string;
  layoutWidth: number;
  layoutHeight: number;
  objectUrl: string;
  original: ReadonlyArray<Readonly<{
    property: string;
    value: string;
    priority: string;
  }>>;
}>();
const BACKGROUND_PROPERTIES = [
  "background-clip",
  "background-image",
  "background-origin",
  "background-position",
  "background-repeat",
  "background-size",
  "display",
  "width",
  "height",
] as const;

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

function createProjectionObjectUrl(
  documentNode: Document,
  visual: RuntimeVisualProjection["visuals"][number],
): string | null {
  const view = documentNode.defaultView;
  if (!view) return null;
  const bytes = new Uint8Array(visual.pngBytes);
  return view.URL.createObjectURL(new view.Blob(
    [bytes.buffer],
    { type: "image/png" },
  ));
}

function releaseImageObjectUrl(image: HTMLImageElement | null) {
  if (!image) return;
  const objectUrl = objectUrlByImage.get(image);
  if (!objectUrl) return;
  try {
    image.ownerDocument.defaultView?.URL.revokeObjectURL(objectUrl);
  } catch {
    // A discarded frame may already have retired its Blob URL registry.
  }
  objectUrlByImage.delete(image);
}

function finishPendingProjection(host: HTMLElement, pending: HTMLElement) {
  if (pendingMountByHost.get(host) !== pending) return;
  pendingMountByHost.delete(host);
  pendingHosts.delete(host);
}

function cancelPendingProjection(host: HTMLElement) {
  const pending = pendingMountByHost.get(host);
  if (!pending) return;
  releaseImageObjectUrl(projectionImage(pending));
  pending.remove();
  finishPendingProjection(host, pending);
}

function cancelDocumentPendingProjections(documentNode: Document) {
  for (const host of [...pendingHosts]) {
    if (host.ownerDocument === documentNode) cancelPendingProjection(host);
  }
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
  setImportantStyle(image, "width", "100%");
  setImportantStyle(image, "height", "100%");
  setImportantStyle(image, "max-width", "100%");
  setImportantStyle(image, "max-height", "100%");
  setImportantStyle(image, "object-fit", "contain");
  setImportantStyle(image, "object-position", "left top");
  setImportantStyle(image, "margin", "0");
  setImportantStyle(image, "padding", "0");
  setImportantStyle(image, "border", "0");
  setImportantStyle(image, "pointer-events", "none");
  setImportantStyle(image, "user-select", "none");
  return image;
}

function initialLayoutMode(host: HTMLElement): "host" | "intrinsic" {
  const style = host.ownerDocument.defaultView?.getComputedStyle(host);
  if (!style) return "intrinsic";
  const numeric = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const occupiedWidth = host.clientWidth
    - numeric(style.paddingLeft)
    - numeric(style.paddingRight);
  const occupiedHeight = host.clientHeight
    - numeric(style.paddingTop)
    - numeric(style.paddingBottom);
  return occupiedWidth >= 1 && occupiedHeight >= 1
    ? "host"
    : "intrinsic";
}

function preservedPaintedScale(host: HTMLElement): { x: number; y: number } {
  let scaleX = 1;
  let scaleY = 1;
  for (let node: HTMLElement | null = host; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (!style) continue;
    const match = /^matrix\(([^)]+)\)$/u.exec(style.transform);
    if (match) {
      const values = match[1]
        .split(",")
        .map((value) => Number.parseFloat(value));
      if (
        values.length === 6
        && values.every(Number.isFinite)
        && values[0] > 0
        && values[3] > 0
        && Math.abs(values[1]) < 0.000001
        && Math.abs(values[2]) < 0.000001
      ) {
        scaleX *= values[0];
        scaleY *= values[3];
      }
    }
    const zoom = Number.parseFloat(style.zoom);
    if (Number.isFinite(zoom) && zoom > 0) {
      scaleX *= zoom;
      scaleY *= zoom;
    }
  }
  return {
    x: Math.max(0.000001, scaleX),
    y: Math.max(0.000001, scaleY),
  };
}

function styleLength(style: CSSStyleDeclaration, property: string): number {
  const value = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) ? value : 0;
}

function backgroundProjectionDimension(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
  dimension: "width" | "height",
): number {
  const style = host.ownerDocument.defaultView?.getComputedStyle(host);
  const scale = preservedPaintedScale(host);
  const contentLength = dimension === "width"
    ? visual.layoutWidth / scale.x
    : visual.layoutHeight / scale.y;
  if (!style || style.boxSizing !== "border-box") {
    return Math.max(1, contentLength);
  }
  const suffix = dimension === "width" ? "left" : "top";
  const oppositeSuffix = dimension === "width" ? "right" : "bottom";
  const boxExtras = [
    `padding-${suffix}`,
    `padding-${oppositeSuffix}`,
    `border-${suffix}-width`,
    `border-${oppositeSuffix}-width`,
  ].reduce((total, property) => total + styleLength(style, property), 0);
  return Math.max(1, contentLength + boxExtras);
}

function configureBackgroundProjectionGeometry(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
) {
  if (host.ownerDocument.defaultView?.getComputedStyle(host).display === "inline") {
    setImportantStyle(host, "display", "inline-block");
  }
  setImportantStyle(
    host,
    "width",
    `${backgroundProjectionDimension(host, visual, "width")}px`,
  );
  setImportantStyle(
    host,
    "height",
    `${backgroundProjectionDimension(host, visual, "height")}px`,
  );
}

function configureProjectionLayer(
  host: HTMLElement,
  root: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
) {
  const mode = root.getAttribute(RUNTIME_VISUAL_LAYOUT_ATTRIBUTE)
    ?? initialLayoutMode(host);
  root.setAttribute(RUNTIME_VISUAL_LAYOUT_ATTRIBUTE, mode);
  const hostDisplay = host.ownerDocument.defaultView
    ?.getComputedStyle(host).display;
  setImportantStyle(
    root,
    "display",
    hostDisplay === "inline" ? "inline-block" : "block",
  );
  setImportantStyle(root, "box-sizing", "border-box");
  setImportantStyle(root, "min-width", "0");
  if (mode === "host") {
    setImportantStyle(root, "width", "100%");
    setImportantStyle(root, "max-width", "100%");
    setImportantStyle(root, "height", "100%");
    setImportantStyle(root, "max-height", "100%");
    root.style.removeProperty("aspect-ratio");
  } else {
    const scale = preservedPaintedScale(host);
    setImportantStyle(root, "width", `${visual.layoutWidth / scale.x}px`);
    setImportantStyle(root, "height", `${visual.layoutHeight / scale.y}px`);
    setImportantStyle(root, "max-width", "none");
    setImportantStyle(root, "max-height", "none");
    root.style.removeProperty("aspect-ratio");
  }
  setImportantStyle(root, "overflow", "hidden");
  setImportantStyle(root, "line-height", "0");
  setImportantStyle(root, "margin", "0");
  setImportantStyle(root, "padding", "0");
  setImportantStyle(root, "border", "0");
  setImportantStyle(root, "pointer-events", "none");
  setImportantStyle(root, "user-select", "none");
}

function observeProjectionLayer(
  host: HTMLElement,
  root: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
) {
  if (
    observedRootByHost.get(host) === root
    && resizeObserverByHost.has(host)
  ) return;
  resizeObserverByHost.get(host)?.disconnect();
  const ResizeObserverClass = host.ownerDocument.defaultView?.ResizeObserver;
  if (!ResizeObserverClass) return;
  const observer = new ResizeObserverClass(() => {
    if (!root.isConnected || root.parentElement !== host) {
      observer.disconnect();
      if (resizeObserverByHost.get(host) === observer) {
        resizeObserverByHost.delete(host);
        observedRootByHost.delete(host);
      }
      return;
    }
    configureProjectionLayer(host, root, visual);
  });
  observer.observe(host);
  resizeObserverByHost.set(host, observer);
  observedRootByHost.set(host, root);
}

function createContentProjection(
  documentNode: Document,
  host: HTMLElement,
  image: HTMLImageElement,
  visual: RuntimeVisualProjection["visuals"][number],
  existing: HTMLElement | null,
): HTMLElement {
  const layer = documentNode.createElement("span");
  layer.setAttribute(RUNTIME_VISUAL_ATTRIBUTE, "runtime-content-layer");
  layer.setAttribute("contenteditable", "false");
  layer.setAttribute("aria-hidden", "true");
  const existingMode = existing?.getAttribute(RUNTIME_VISUAL_LAYOUT_ATTRIBUTE);
  layer.setAttribute(
    RUNTIME_VISUAL_LAYOUT_ATTRIBUTE,
    existingMode === "host" || existingMode === "intrinsic"
      ? existingMode
      : initialLayoutMode(host),
  );
  layer.append(image);
  configureProjectionLayer(host, layer, visual);
  return layer;
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

function isBackgroundProjectionRoot(root: HTMLElement): boolean {
  return root.getAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE)
    === "runtime-bitmap-background";
}

function restoreBackgroundProjection(host: HTMLElement) {
  const state = backgroundProjectionByHost.get(host);
  if (state) {
    for (const item of state.original) {
      if (item.value) {
        host.style.setProperty(item.property, item.value, item.priority);
      } else {
        host.style.removeProperty(item.property);
      }
    }
    try {
      host.ownerDocument.defaultView?.URL.revokeObjectURL(state.objectUrl);
    } catch {
      // The owning edit frame may already be gone.
    }
    backgroundProjectionByHost.delete(host);
  }
  host.removeAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE);
  host.removeAttribute(RUNTIME_VISUAL_CONTENT_SHA_ATTRIBUTE);
  host.removeAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE);
}

function commitBackgroundProjection(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
  objectUrl: string,
) {
  const previous = backgroundProjectionByHost.get(host);
  const original = previous?.original ?? Object.freeze(
    BACKGROUND_PROPERTIES.map((property) => Object.freeze({
      property,
      value: host.style.getPropertyValue(property),
      priority: host.style.getPropertyPriority(property),
    })),
  );
  setImportantStyle(host, "background-image", `url("${objectUrl}")`);
  setImportantStyle(host, "background-clip", "content-box");
  setImportantStyle(host, "background-origin", "content-box");
  setImportantStyle(host, "background-position", "left top");
  setImportantStyle(host, "background-repeat", "no-repeat");
  setImportantStyle(host, "background-size", "contain");
  configureBackgroundProjectionGeometry(host, visual);
  host.setAttribute(
    RUNTIME_VISUAL_HOST_ATTRIBUTE,
    "runtime-bitmap-background",
  );
  host.setAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE, visual.captureKey);
  host.setAttribute(
    RUNTIME_VISUAL_CONTENT_SHA_ATTRIBUTE,
    visual.runtimeContentSha256,
  );
  backgroundProjectionByHost.set(host, {
    runtimeContentSha256: visual.runtimeContentSha256,
    layoutWidth: visual.layoutWidth,
    layoutHeight: visual.layoutHeight,
    objectUrl,
    original,
  });
  if (previous?.objectUrl && previous.objectUrl !== objectUrl) {
    try {
      host.ownerDocument.defaultView?.URL.revokeObjectURL(previous.objectUrl);
    } catch {
      // A superseded Blob URL has no remaining presentation authority.
    }
  }
}

function stageBackgroundProjection(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
) {
  const preload = host.ownerDocument.createElement("img");
  const objectUrl = createProjectionObjectUrl(host.ownerDocument, visual);
  if (!objectUrl) return;
  objectUrlByImage.set(preload, objectUrl);
  cancelPendingProjection(host);
  pendingMountByHost.set(host, preload);
  pendingHosts.add(host);
  let settled = false;
  const commit = () => {
    if (settled) return;
    if (pendingMountByHost.get(host) !== preload || !host.isConnected) {
      settled = true;
      releaseImageObjectUrl(preload);
      finishPendingProjection(host, preload);
      return;
    }
    settled = true;
    const view = host.ownerDocument.defaultView;
    const apply = () => {
      if (pendingMountByHost.get(host) !== preload || !host.isConnected) {
        releaseImageObjectUrl(preload);
        finishPendingProjection(host, preload);
        return;
      }
      objectUrlByImage.delete(preload);
      commitBackgroundProjection(host, visual, objectUrl);
      finishPendingProjection(host, preload);
    };
    if (view) view.requestAnimationFrame(apply);
    else apply();
  };
  const reject = () => {
    if (settled) return;
    settled = true;
    releaseImageObjectUrl(preload);
    finishPendingProjection(host, preload);
  };
  preload.addEventListener("load", commit, { once: true });
  preload.addEventListener("error", reject, { once: true });
  preload.src = objectUrl;
  if (preload.complete && preload.naturalWidth > 0) commit();
  else void preload.decode?.().then(commit, () => undefined);
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
  if (isBackgroundProjectionRoot(root)) return root;
  if (root.tagName === "TR") return root.parentElement;
  return root.parentElement;
}

function removeProjectionRoot(root: HTMLElement) {
  if (isBackgroundProjectionRoot(root)) {
    restoreBackgroundProjection(root);
    return;
  }
  const host = projectionHost(root);
  if (host && resizeObserverByHost.has(host)) {
    resizeObserverByHost.get(host)?.disconnect();
    resizeObserverByHost.delete(host);
    observedRootByHost.delete(host);
  }
  releaseImageObjectUrl(projectionImage(root));
  root.remove();
}

function artifactMatches(
  root: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
): boolean {
  if (isBackgroundProjectionRoot(root)) {
    return Boolean(
      root.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) === visual.captureKey
      && root.getAttribute(RUNTIME_VISUAL_CONTENT_SHA_ATTRIBUTE)
        === visual.runtimeContentSha256
      && backgroundProjectionByHost.get(root)?.runtimeContentSha256
        === visual.runtimeContentSha256
      && backgroundProjectionByHost.get(root)?.layoutWidth === visual.layoutWidth
      && backgroundProjectionByHost.get(root)?.layoutHeight === visual.layoutHeight
    );
  }
  const image = projectionImage(root);
  return Boolean(
    image
    && root.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) === visual.captureKey
    && root.getAttribute(RUNTIME_VISUAL_CONTENT_SHA_ATTRIBUTE)
      === visual.runtimeContentSha256
    && image.width === visual.width
    && image.height === visual.height,
  );
}

function createProjectionMount(
  documentNode: Document,
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
  existing: HTMLElement | null,
): { image: HTMLImageElement; root: HTMLElement } {
  const image = createProjectionImage(documentNode, visual);
  const root = visual.tagName === "tbody"
    ? createTableProjection(documentNode, host, image)
    : createContentProjection(documentNode, host, image, visual, existing);
  root.setAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE, visual.captureKey);
  root.setAttribute(
    RUNTIME_VISUAL_CONTENT_SHA_ATTRIBUTE,
    visual.runtimeContentSha256,
  );
  return { image, root };
}

function stageProjectionMount(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
  existing: HTMLElement | null,
) {
  const documentNode = host.ownerDocument;
  const { image, root } = createProjectionMount(
    documentNode,
    host,
    visual,
    existing,
  );
  const objectUrl = createProjectionObjectUrl(documentNode, visual);
  if (!objectUrl) return;
  objectUrlByImage.set(image, objectUrl);
  cancelPendingProjection(host);
  pendingMountByHost.set(host, root);
  pendingHosts.add(host);
  let settled = false;
  const commit = () => {
    if (settled) return;
    if (pendingMountByHost.get(host) !== root || !host.isConnected) {
      settled = true;
      releaseImageObjectUrl(image);
      finishPendingProjection(host, root);
      return;
    }
    settled = true;
    const view = host.ownerDocument.defaultView;
    const apply = () => {
      if (pendingMountByHost.get(host) !== root || !host.isConnected) {
        releaseImageObjectUrl(image);
        finishPendingProjection(host, root);
        return;
      }
      if (existing?.isConnected && projectionHost(existing) === host) {
        if (!isBackgroundProjectionRoot(existing)) {
          releaseImageObjectUrl(projectionImage(existing));
          existing.replaceWith(root);
        }
      } else {
        host.append(root);
      }
      if (visual.tagName !== "tbody") {
        configureProjectionLayer(host, root, visual);
        observeProjectionLayer(host, root, visual);
      }
      finishPendingProjection(host, root);
    };
    if (view) view.requestAnimationFrame(apply);
    else apply();
  };
  const reject = () => {
    if (settled) return;
    settled = true;
    releaseImageObjectUrl(image);
    finishPendingProjection(host, root);
  };
  image.addEventListener("load", commit, { once: true });
  image.addEventListener("error", reject, { once: true });
  image.src = objectUrl;
  if (image.complete && image.naturalWidth > 0) commit();
  else void image.decode?.().then(commit, () => undefined);
}

export function restoreRuntimeVisualProjection(documentNode: Document) {
  cancelDocumentPendingProjections(documentNode);
  projectionRoots(documentNode).forEach(removeProjectionRoot);
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_ATTRIBUTE}]`,
  ).forEach((element) => {
    if (isBackgroundProjectionRoot(element)) restoreBackgroundProjection(element);
    else element.remove();
  });
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
    cancelDocumentPendingProjections(documentNode);
    return projectionRoots(documentNode).length;
  }
  if (projection.sourceSha256 !== sourceIndex.sourceSha256) {
    cancelDocumentPendingProjections(documentNode);
    return projectionRoots(documentNode).length;
  }

  const existingRoots = projectionRoots(documentNode);
  const acceptedRoots = new Set<HTMLElement>();
  const desiredHosts = new Set<HTMLElement>();
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
    desiredHosts.add(element);

    const hostRoots = existingRoots.filter((root) => (
      projectionHost(root) === element
    ));
    const matching = hostRoots.find((root) => artifactMatches(root, visual)) ?? null;
    if (visual.tagName === "canvas" || visual.tagName === "svg") {
      acceptedRoots.add(element);
      if (matching) {
        cancelPendingProjection(element);
        configureBackgroundProjectionGeometry(element, visual);
      }
      else stageBackgroundProjection(element, visual);
      applied += 1;
      continue;
    }
    element.setAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE, "runtime-bitmap");
    if (matching) {
      cancelPendingProjection(element);
      acceptedRoots.add(matching);
      if (visual.tagName !== "tbody") {
        configureProjectionLayer(element, matching, visual);
        observeProjectionLayer(element, matching, visual);
      }
    } else {
      const existing = hostRoots[0] ?? null;
      if (existing) acceptedRoots.add(existing);
      stageProjectionMount(element, visual, existing);
    }
    applied += 1;
  }

  for (const root of existingRoots) {
    if (!acceptedRoots.has(root)) removeProjectionRoot(root);
  }
  for (const host of [...pendingHosts]) {
    if (host.ownerDocument === documentNode && !desiredHosts.has(host)) {
      cancelPendingProjection(host);
    }
  }
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_HOST_ATTRIBUTE}]`,
  ).forEach((element) => {
    const hasProjection = isBackgroundProjectionRoot(element)
      || Array.from(element.children).some((child) => (
        child.hasAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE)
      ));
    if (!hasProjection && !pendingMountByHost.has(element)) {
      element.removeAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE);
    }
  });
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_ATTRIBUTE}]:not([${RUNTIME_VISUAL_KEY_ATTRIBUTE}])`,
  ).forEach((element) => {
    if (!element.closest(`[${RUNTIME_VISUAL_KEY_ATTRIBUTE}]`)) element.remove();
  });
  return applied;
}
