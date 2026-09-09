import {
  createTargetRef,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import { isEditableIslandTarget } from "../lib/editable-island.js";
import { isTransparentSourceTextElement } from "../lib/source-text-map.js";
import { disableExecutableMarkup } from "./html-preview-sandbox.js";
import {
  SOURCE_ELEMENT_ATTRIBUTE,
  sourceElementFromDom,
  sourceElementId,
  uniqueSourceElement,
} from "./html-canvas-source-element";
import { PAGEROOT_ELEMENT_ID_ATTRIBUTE } from "../../shared/pageroot-element-identity.mjs";
import type {
  SourceElementValue,
  SourceIndexValue,
  SourceTargetRef,
  TextRangeSegment,
} from "./html-canvas-internal-types";

function sourceParentPagerootId(
  sourceIndex: SourceIndexValue,
  sourceElement: SourceElementValue,
): string | null {
  if (!sourceElement.parentId) return null;
  const parent = sourceIndex.byNodeId.get(sourceElement.parentId);
  return parent?.type === "element" ? parent.pagerootId ?? null : null;
}

export function sourceTextNodeForDomText(
  textNode: Text,
  sourceIndex: SourceIndexValue,
): { nodeId: string; value: string } | null {
  const parentElement = textNode.parentElement;
  const sourceParent = sourceElementFromDom(parentElement, sourceIndex);
  if (!parentElement || !sourceParent) return null;
  const childIndex = Array.from(parentElement.childNodes).indexOf(textNode);
  const sourceChildId = sourceParent.childIds?.[childIndex];
  const sourceText = sourceChildId ? sourceIndex.byNodeId.get(sourceChildId) : null;
  if (
    !sourceText
    || sourceText.type !== "text"
    || sourceText.value !== textNode.data
  ) return null;
  return { nodeId: sourceText.nodeId, value: sourceText.value };
}

export function isCanonicalSourceElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): boolean {
  const sourceElement = sourceElementFromDom(element, sourceIndex);
  const pagerootId = sourceElement?.pagerootId ?? null;
  if (!sourceElement || !pagerootId) return false;
  if (sourceElementId(element) !== pagerootId) return false;
  const domParent = element.parentElement?.closest<HTMLElement>(
    `[${SOURCE_ELEMENT_ATTRIBUTE}]`,
  ) ?? null;
  return sourceElementId(domParent) === sourceParentPagerootId(sourceIndex, sourceElement);
}

export function nativeEditHostForElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): HTMLElement | null {
  let candidate = element.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`);
  let nearestSafeCandidate: HTMLElement | null = null;
  while (candidate) {
    if (!isCanonicalSourceElement(candidate, sourceIndex)) return null;
    const candidateNode = sourceElementFromDom(candidate, sourceIndex);
    if (!candidateNode) return null;
    try {
      const candidateTargetRef = createTargetRef(
        sourceIndex,
        candidateNode,
        { level: "subregion" },
      ) as SourceTargetRef;
      if (isEditableIslandTarget(sourceIndex, candidateTargetRef).editable) {
        nearestSafeCandidate = candidate;
      }
    } catch {
      return null;
    }
    const computedDisplay = candidate.ownerDocument.defaultView
      ?.getComputedStyle(candidate).display.toLowerCase() ?? "";
    const tagName = candidate.tagName.toLowerCase();
    const standaloneTransparentBox = (
      computedDisplay !== "inline"
      && computedDisplay !== "contents"
    );
    const climbThrough = tagName === "br" || (
      isTransparentSourceTextElement(tagName) && !standaloneTransparentBox
    );
    if (!climbThrough) break;
    const parentCandidate = candidate.parentElement?.closest<HTMLElement>(
      `[${SOURCE_ELEMENT_ATTRIBUTE}]`,
    ) ?? null;
    if (
      !parentCandidate
      || parentCandidate === candidate.ownerDocument.body
      || parentCandidate === candidate.ownerDocument.documentElement
    ) break;
    candidate = parentCandidate;
  }
  return nearestSafeCandidate;
}

export function sourceTextParentsForSegments(
  rootElement: HTMLElement,
  segments: readonly TextRangeSegment[],
  sourceIndex: SourceIndexValue,
): HTMLElement[] | null {
  const wantedIds = new Set(segments.map((segment) => segment.textNodeId));
  const parentsByTextId = new Map<string, HTMLElement>();
  const documentNode = rootElement.ownerDocument;
  const showText = documentNode.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = documentNode.createTreeWalker(rootElement, showText);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const sourceText = sourceTextNodeForDomText(textNode, sourceIndex);
    if (sourceText && wantedIds.has(sourceText.nodeId) && textNode.parentElement) {
      parentsByTextId.set(sourceText.nodeId, textNode.parentElement);
    }
    current = walker.nextNode();
  }
  if ([...wantedIds].some((nodeId) => !parentsByTextId.has(nodeId))) return null;
  return [...new Set(
    segments.map((segment) => parentsByTextId.get(segment.textNodeId)!),
  )];
}

export { alignPreviewSourceSurface } from "../lib/align-preview-source-surface.js";

export function sourceBackedPreviewElements(documentNode: Document): Element[] {
  const elements: Element[] = [];
  const visit = (element: Element) => {
    if (element.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE)) elements.push(element);
    const childElements = element.tagName === "TEMPLATE"
      ? Array.from((element as HTMLTemplateElement).content.children)
      : Array.from(element.children);
    childElements.forEach(visit);
  };
  if (documentNode.documentElement) visit(documentNode.documentElement);
  return elements;
}

export function canonicalNativeHostPreview(
  rootElement: HTMLElement,
  nextElementId: string,
  nextIndex: SourceIndexValue,
): HTMLElement | null {
  const view = rootElement.ownerDocument.defaultView;
  if (!view || !nextElementId) return null;
  const sourceElement = nextIndex.byPagerootId.get(nextElementId)
    ?? nextIndex.byNodeId.get(nextElementId);
  const pagerootId = sourceElement?.type === "element"
    ? sourceElement.pagerootId
    : nextElementId;
  if (!pagerootId) return null;
  const detachedDocument = new view.DOMParser().parseFromString(
    disableExecutableMarkup(nextIndex.source),
    "text/html",
  );
  const detachedTarget = uniqueSourceElement(detachedDocument, pagerootId);
  return detachedTarget?.tagName === rootElement.tagName ? detachedTarget : null;
}

export function remountNativeHostFromSource(
  hostElement: HTMLElement,
  nodeId: string,
  sourceIndex: SourceIndexValue,
): boolean {
  const canonical = canonicalNativeHostPreview(hostElement, nodeId, sourceIndex);
  if (!canonical) return false;
  const documentNode = hostElement.ownerDocument;
  hostElement.replaceChildren(
    ...Array.from(canonical.childNodes).map((node) => documentNode.importNode(node, true)),
  );
  return true;
}

export type StableMountedSourceNodeRefresh = Readonly<{
  element: HTMLElement;
  pagerootId: string;
}>;

/**
 * Lists live elements whose persistent Stable ID still resolves exactly in the
 * latest source. Runtime DOM is not rewritten with parse-local node ids.
 */
export function refreshStableMountedPreviewSourceNodeIds(
  documentNode: Document,
  nextIndex: SourceIndexValue,
): readonly StableMountedSourceNodeRefresh[] {
  const ViewHTMLElement = documentNode.defaultView?.HTMLElement;
  return sourceBackedPreviewElements(documentNode).flatMap((element) => {
    if (!ViewHTMLElement || !(element instanceof ViewHTMLElement)) return [];
    const pagerootId = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    const nextElement = pagerootId ? nextIndex.byPagerootId.get(pagerootId) : null;
    if (
      !pagerootId
      || !nextElement
      || nextElement.type !== "element"
      || nextElement.tagName !== element.tagName.toLowerCase()
    ) return [];
    return [{ element, pagerootId }];
  });
}

export function adoptCanonicalHistoryIslandInPlace(options: {
  rootElement: HTMLElement;
  previousIndex: SourceIndexValue;
  nextIndex: SourceIndexValue;
  previousTargetRef: SourceTargetRef;
  nextTargetRef: SourceTargetRef;
}): boolean {
  const {
    rootElement,
    previousIndex,
    nextIndex,
    previousTargetRef,
    nextTargetRef,
  } = options;
  const documentNode = rootElement.ownerDocument;
  const previousResolution = resolveTargetRef(previousIndex, previousTargetRef);
  const nextResolution = resolveTargetRef(nextIndex, nextTargetRef);
  if (
    previousResolution.resolution !== "exact"
    || nextResolution.resolution !== "exact"
    || previousResolution.target?.type !== "element"
    || nextResolution.target?.type !== "element"
    || sourceElementId(rootElement) !== previousResolution.target.pagerootId
  ) return false;

  const previousCapability = isEditableIslandTarget(
    previousIndex,
    previousTargetRef,
  );
  const nextCapability = isEditableIslandTarget(nextIndex, nextTargetRef);
  if (!previousCapability.editable || !nextCapability.editable) return false;
  const previousIsland = previousCapability.island;
  const nextIsland = nextCapability.island;
  if (
    previousIsland.element.pagerootId !== previousResolution.target.pagerootId
    || nextIsland.element.pagerootId !== nextResolution.target.pagerootId
    || previousIsland.element.tagName !== nextIsland.element.tagName
    || previousIndex.source.slice(0, previousIsland.contentRange.startOffset)
      !== nextIndex.source.slice(0, nextIsland.contentRange.startOffset)
    || previousIndex.source.slice(previousIsland.contentRange.endOffset)
      !== nextIndex.source.slice(nextIsland.contentRange.endOffset)
  ) return false;

  const canonicalTarget = canonicalNativeHostPreview(
    rootElement,
    String(nextIsland.element.pagerootId || nextIsland.element.nodeId || ""),
    nextIndex,
  );
  if (!canonicalTarget) return false;
  const canonicalChildren = Array.from(canonicalTarget.childNodes).map(
    (node) => documentNode.importNode(node, true),
  );

  rootElement.replaceChildren(...canonicalChildren);
  const nextElements = nextIndex.elements as SourceElementValue[];
  const mountedElements = sourceBackedPreviewElements(documentNode);
  if (
    mountedElements.length !== nextElements.length
    || mountedElements.some((element, index) => (
      element.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) !== nextElements[index].pagerootId
      || element.tagName.toLowerCase() !== nextElements[index].tagName
    ))
  ) throw new Error("历史文字结果无法保持当前画布的 Stable ID 映射。");
  return true;
}

/**
 * Reconcile a range-style projection without detaching unchanged source
 * subtrees (their runtime children, canvas pixels and listeners belong to the
 * mounted document). Plan everything before touching the live DOM. An
 * unaccounted runtime child in a changed branch requires a fresh candidate.
 */
export function reconcileRangeStyleInPlace(
  liveRoot: HTMLElement,
  canonicalRoot: Element,
  previousIndex: SourceIndexValue,
  nextIndex: SourceIndexValue,
): readonly HTMLElement[] | null {
  const documentNode = liveRoot.ownerDocument;
  const imported: HTMLElement[] = [];
  const pending: Array<() => void> = [];
  const liveById = new Map<string, Element>();
  for (const element of [liveRoot, ...Array.from(liveRoot.querySelectorAll(`[${SOURCE_ELEMENT_ATTRIBUTE}]`))]) {
    const id = element.getAttribute(SOURCE_ELEMENT_ATTRIBUTE);
    if (!id || liveById.has(id)) return null;
    liveById.set(id, element);
  }
  const plan = (canonical: Node): Node => {
    if (canonical.nodeType !== 1) return documentNode.importNode(canonical, true);
    const element = canonical as Element;
    const id = element.getAttribute(SOURCE_ELEMENT_ATTRIBUTE);
    const live = id ? liveById.get(id) : null;
    const previous = id ? previousIndex.byPagerootId.get(id) : null;
    const next = id ? nextIndex.byPagerootId.get(id) : null;
    if (live && previous?.raw === next?.raw && previous?.raw) return live;
    if (live && live.tagName !== element.tagName) throw new Error("Changed source shape");
    if (live && Array.from(live.children).some((child) => !child.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE))) {
      throw new Error("Runtime children in changed source branch");
    }
    const target = live || documentNode.importNode(element, false) as Element;
    if (!live && target instanceof documentNode.defaultView!.HTMLElement) imported.push(target);
    const children = Array.from(element.childNodes).map(plan);
    pending.push(() => {
      // Change only authored style when this operation changed it. Never
      // restore all source attributes over runtime state.
      const authoredStyle = (source: typeof previous) => source?.attributesByName?.get("style")?.[0]?.value ?? null;
      if (live && authoredStyle(previous) !== authoredStyle(next)) {
        const style = element.getAttribute("style");
        if (style === null) target.removeAttribute("style");
        else target.setAttribute("style", style);
      }
      let cursor = target.firstChild;
      for (const child of children) {
        if (child === cursor) cursor = cursor.nextSibling;
        else target.insertBefore(child, cursor);
      }
      while (cursor) { const nextSibling = cursor.nextSibling; target.removeChild(cursor); cursor = nextSibling; }
    });
    return target;
  };
  try {
    if (plan(canonicalRoot) !== liveRoot) return null;
  } catch { return null; }
  pending.forEach((apply) => apply());
  return imported;
}

/** A continuity check, not source authority or a general script-completion oracle.
 * An unchanged, visible chart host must regain its generated surfaces before
 * replacing the current document. The caller owns identity and the deadline.
 */
export function runtimeSurfacesReady(
  active: Document | null,
  candidate: Document,
  nextIndex: SourceIndexValue,
): boolean {
  if (!active?.defaultView) return true;
  const hosts = new Map<string, { canvas: number; svg: number }>();
  for (const surface of Array.from(active.querySelectorAll("canvas, svg"))) {
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > active.defaultView.innerHeight) continue;
    const host = surface.closest(`[${SOURCE_ELEMENT_ATTRIBUTE}]`);
    const id = host?.getAttribute(SOURCE_ELEMENT_ATTRIBUTE);
    if (!id || !nextIndex.byPagerootId.has(id)) continue;
    const expected = hosts.get(id) || { canvas: 0, svg: 0 };
    expected[surface.tagName.toLowerCase() as "canvas" | "svg"] += 1;
    hosts.set(id, expected);
  }
  for (const [id, expected] of hosts) {
    const host = uniqueSourceElement(candidate, id);
    if (!host) return false;
    for (const kind of ["canvas", "svg"] as const) {
      const surfaces = [ ...(host.matches(kind) ? [host] : []), ...Array.from(host.querySelectorAll(kind)) ];
      const visible = surfaces.filter((surface) => {
        const rect = surface.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (visible.length < expected[kind]) return false;
    }
  }
  return true;
}
