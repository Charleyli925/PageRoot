import type { RuntimeVisualProjection } from "../domain/runtime-snapshot-hosts.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
} from "../lib/source-index.js";

export const RUNTIME_VISUAL_ATTRIBUTE = "data-pageroot-readonly-visual";
export const RUNTIME_VISUAL_HOST_ATTRIBUTE =
  "data-pageroot-readonly-visual-host";
export const RUNTIME_VISUAL_KEY_ATTRIBUTE =
  "data-pageroot-readonly-visual-key";
const RUNTIME_VISUAL_SHA_ATTRIBUTE =
  "data-pageroot-readonly-visual-sha";

const objectUrlByImage = new WeakMap<HTMLImageElement, string>();
const pendingImageByHost = new WeakMap<HTMLElement, HTMLImageElement>();
const pendingBackgroundUrlByHost = new WeakMap<HTMLElement, string>();
const backgroundObjectUrlByHost = new WeakMap<HTMLElement, string>();
const backgroundStyleByHost = new WeakMap<HTMLElement, ReadonlyArray<Readonly<{
  property: string;
  value: string;
  priority: string;
}>>>();
const BACKGROUND_PROPERTIES = [
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "display",
  "height",
  "width",
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

function runtimeImages(host: HTMLElement): HTMLImageElement[] {
  return Array.from(host.children).flatMap((child) => (
    child.tagName.toLowerCase() === "img"
    && child.getAttribute(RUNTIME_VISUAL_ATTRIBUTE) === "runtime-bitmap"
      ? [child as HTMLImageElement]
      : []
  ));
}

function authoredContentIsEmpty(host: HTMLElement): boolean {
  return Array.from(host.childNodes).every((node) => (
    node.nodeType === 8
    || (node.nodeType === 3 && !(node.textContent ?? "").trim())
    || (node.nodeType === 1
      && (node as Element).tagName.toLowerCase() === "img"
      && (node as Element).getAttribute(RUNTIME_VISUAL_ATTRIBUTE) === "runtime-bitmap")
  ));
}

function setImportantStyle(
  element: HTMLElement,
  property: string,
  value: string,
) {
  element.style.setProperty(property, value, "important");
}

function releaseImageObjectUrl(image: HTMLImageElement | null) {
  if (!image) return;
  const objectUrl = objectUrlByImage.get(image);
  if (!objectUrl) return;
  try {
    image.ownerDocument.defaultView?.URL.revokeObjectURL(objectUrl);
  } catch {
    // The disposable frame can retire before its Blob URL registry does.
  }
  objectUrlByImage.delete(image);
}

function releaseBackgroundObjectUrl(host: HTMLElement) {
  const objectUrl = backgroundObjectUrlByHost.get(host);
  if (!objectUrl) return;
  try {
    host.ownerDocument.defaultView?.URL.revokeObjectURL(objectUrl);
  } catch {
    // The iframe may already be gone.
  }
  backgroundObjectUrlByHost.delete(host);
}

function releasePendingBackgroundObjectUrl(host: HTMLElement) {
  const objectUrl = pendingBackgroundUrlByHost.get(host);
  if (!objectUrl) return;
  try {
    host.ownerDocument.defaultView?.URL.revokeObjectURL(objectUrl);
  } catch {
    // The iframe may already be gone.
  }
  pendingBackgroundUrlByHost.delete(host);
}

function createObjectUrl(
  documentNode: Document,
  visual: RuntimeVisualProjection["visuals"][number],
): string | null {
  const view = documentNode.defaultView;
  if (!view) return null;
  const bytes = new Uint8Array(visual.pngBytes);
  return view.URL.createObjectURL(new view.Blob([bytes], { type: "image/png" }));
}

function createImage(
  documentNode: Document,
  visual: RuntimeVisualProjection["visuals"][number],
  objectUrl: string,
): HTMLImageElement {
  const image = documentNode.createElement("img");
  image.setAttribute(RUNTIME_VISUAL_ATTRIBUTE, "runtime-bitmap");
  image.setAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE, visual.captureKey);
  image.setAttribute(RUNTIME_VISUAL_SHA_ATTRIBUTE, visual.pngSha256);
  image.setAttribute("contenteditable", "false");
  image.setAttribute("aria-hidden", "true");
  image.setAttribute("alt", "");
  image.setAttribute("draggable", "false");
  image.width = visual.width;
  image.height = visual.height;
  setImportantStyle(image, "display", "block");
  setImportantStyle(image, "box-sizing", "border-box");
  setImportantStyle(image, "width", "100%");
  setImportantStyle(image, "height", "auto");
  setImportantStyle(image, "max-width", "100%");
  setImportantStyle(image, "object-fit", "contain");
  setImportantStyle(image, "margin", "0");
  setImportantStyle(image, "padding", "0");
  setImportantStyle(image, "border", "0");
  setImportantStyle(image, "pointer-events", "none");
  setImportantStyle(image, "user-select", "none");
  objectUrlByImage.set(image, objectUrl);
  return image;
}

function imageMatches(
  image: HTMLImageElement | null,
  visual: RuntimeVisualProjection["visuals"][number],
): boolean {
  return Boolean(
    image
    && image.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE) === visual.captureKey
    && image.getAttribute(RUNTIME_VISUAL_SHA_ATTRIBUTE) === visual.pngSha256,
  );
}

function removeImage(image: HTMLImageElement) {
  releaseImageObjectUrl(image);
  image.remove();
}

function stageHostImage(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
) {
  const existing = runtimeImages(host)[0] ?? null;
  if (imageMatches(existing, visual)) {
    const pending = pendingImageByHost.get(host);
    if (pending) releaseImageObjectUrl(pending);
    pending?.remove();
    pendingImageByHost.delete(host);
    return;
  }
  const documentNode = host.ownerDocument;
  const objectUrl = createObjectUrl(documentNode, visual);
  if (!objectUrl) return;
  const pending = createImage(documentNode, visual, objectUrl);
  const previousPending = pendingImageByHost.get(host);
  if (previousPending) releaseImageObjectUrl(previousPending);
  previousPending?.remove();
  pendingImageByHost.set(host, pending);
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (pendingImageByHost.get(host) !== pending || !host.isConnected) {
      releaseImageObjectUrl(pending);
      pendingImageByHost.delete(host);
      return;
    }
    runtimeImages(host).forEach(removeImage);
    host.append(pending);
    pendingImageByHost.delete(host);
    host.setAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE, "runtime-bitmap");
  };
  const fail = () => {
    if (settled) return;
    settled = true;
    if (pendingImageByHost.get(host) === pending) pendingImageByHost.delete(host);
    releaseImageObjectUrl(pending);
  };
  pending.addEventListener("load", finish, { once: true });
  pending.addEventListener("error", fail, { once: true });
  pending.src = objectUrl;
  if (pending.complete && pending.naturalWidth > 0) finish();
  else void pending.decode?.().then(finish, fail);
}

function savedBackgroundStyles(host: HTMLElement) {
  const existing = backgroundStyleByHost.get(host);
  if (existing) return existing;
  const saved = Object.freeze(BACKGROUND_PROPERTIES.map((property) => Object.freeze({
    property,
    value: host.style.getPropertyValue(property),
    priority: host.style.getPropertyPriority(property),
  })));
  backgroundStyleByHost.set(host, saved);
  return saved;
}

function restoreBackground(host: HTMLElement) {
  releaseBackgroundObjectUrl(host);
  const saved = backgroundStyleByHost.get(host);
  saved?.forEach(({ property, value, priority }) => {
    if (value) host.style.setProperty(property, value, priority);
    else host.style.removeProperty(property);
  });
  backgroundStyleByHost.delete(host);
}

function stageDirectBackground(
  host: HTMLElement,
  visual: RuntimeVisualProjection["visuals"][number],
) {
  const currentKey = host.getAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE);
  const currentSha = host.getAttribute(RUNTIME_VISUAL_SHA_ATTRIBUTE);
  if (currentKey === visual.captureKey && currentSha === visual.pngSha256) return;
  const documentNode = host.ownerDocument;
  const objectUrl = createObjectUrl(documentNode, visual);
  if (!objectUrl) return;
  releasePendingBackgroundObjectUrl(host);
  pendingBackgroundUrlByHost.set(host, objectUrl);
  // Mark the host before decoding so a source refresh can cancel this pending
  // replacement instead of leaving a detached object URL alive.
  host.setAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE, "runtime-bitmap");
  const preload = documentNode.createElement("img");
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (pendingBackgroundUrlByHost.get(host) !== objectUrl || !host.isConnected) {
      try {
        documentNode.defaultView?.URL.revokeObjectURL(objectUrl);
      } catch {
        // The document can disappear while an image is decoding.
      }
      return;
    }
    pendingBackgroundUrlByHost.delete(host);
    savedBackgroundStyles(host);
    releaseBackgroundObjectUrl(host);
    backgroundObjectUrlByHost.set(host, objectUrl);
    host.setAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE, "runtime-bitmap");
    host.setAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE, visual.captureKey);
    host.setAttribute(RUNTIME_VISUAL_SHA_ATTRIBUTE, visual.pngSha256);
    setImportantStyle(host, "background-image", `url("${objectUrl}")`);
    setImportantStyle(host, "background-position", "center");
    setImportantStyle(host, "background-repeat", "no-repeat");
    setImportantStyle(host, "background-size", "100% 100%");
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      setImportantStyle(host, "display", "inline-block");
      setImportantStyle(host, "width", `${visual.width}px`);
      setImportantStyle(host, "height", `${visual.height}px`);
    }
  };
  const fail = () => {
    if (settled) return;
    settled = true;
    if (pendingBackgroundUrlByHost.get(host) === objectUrl) {
      pendingBackgroundUrlByHost.delete(host);
    }
    try {
      documentNode.defaultView?.URL.revokeObjectURL(objectUrl);
    } catch {
      // The document can disappear while an image is decoding.
    }
  };
  preload.addEventListener("load", finish, { once: true });
  preload.addEventListener("error", fail, { once: true });
  preload.src = objectUrl;
  if (preload.complete && preload.naturalWidth > 0) finish();
  else void preload.decode?.().then(finish, fail);
}

function removeHostProjection(host: HTMLElement) {
  const pending = pendingImageByHost.get(host);
  if (pending) releaseImageObjectUrl(pending);
  pending?.remove();
  pendingImageByHost.delete(host);
  releasePendingBackgroundObjectUrl(host);
  runtimeImages(host).forEach(removeImage);
  restoreBackground(host);
  host.removeAttribute(RUNTIME_VISUAL_HOST_ATTRIBUTE);
  host.removeAttribute(RUNTIME_VISUAL_KEY_ATTRIBUTE);
  host.removeAttribute(RUNTIME_VISUAL_SHA_ATTRIBUTE);
}

export function restoreRuntimeVisualProjection(documentNode: Document) {
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_HOST_ATTRIBUTE}]`,
  ).forEach(removeHostProjection);
}

/**
 * Applies disposable images only after the current exact SourceIndex resolves
 * the same source-backed host. New images decode off-DOM before replacing an
 * existing image/background, avoiding a blank canvas during refresh.
 */
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
    return 0;
  }
  if (projection.sourceSha256 !== sourceIndex.sourceSha256) return 0;

  const desired = new Set<HTMLElement>();
  let applied = 0;
  projection.visuals.forEach((visual) => {
    const sourceElement = sourceIndex.byNodeId.get(visual.sourceNodeId);
    const host = uniqueSourceElement(documentNode, visual.sourceNodeId);
    if (
      sourceElement?.type !== "element"
      || sourceElement.tagName !== visual.tagName
      || !host
      || host.tagName.toLowerCase() !== visual.tagName
    ) return;
    const direct = visual.kind === "canvas" || visual.kind === "svg";
    if (!direct && (!authoredContentIsEmpty(host) || visual.kind !== "host")) return;
    if (direct && visual.kind !== visual.tagName) return;
    desired.add(host);
    if (direct) stageDirectBackground(host, visual);
    else stageHostImage(host, visual);
    applied += 1;
  });
  documentNode.querySelectorAll<HTMLElement>(
    `[${RUNTIME_VISUAL_HOST_ATTRIBUTE}]`,
  ).forEach((host) => {
    if (!desired.has(host)) removeHostProjection(host);
  });
  return applied;
}
