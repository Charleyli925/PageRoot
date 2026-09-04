import {
  uniqueSourceElement,
} from "./html-canvas-source-element";
import { resolvePageViewContext, type PageViewContext } from "../lib/page-view-context.js";
import {
  activatePageTabContaining,
  isRenderedPageElement,
  pageTabAssociationForElement,
  pageTabAssociations,
  type PageTabAssociation,
} from "../lib/page-presentation-dom";
import type {
  HtmlCanvasCommentedTarget,
  HtmlCanvasCommentLayoutTarget,
} from "./HtmlCanvasEditor.types";

const PAGE_VIEW_CONTEXT_ATTRIBUTE = "data-pageroot-view-context";

function pageViewContextElement(
  documentNode: Document,
  sourceNodeId: string,
): HTMLElement | null {
  return uniqueSourceElement(documentNode, sourceNodeId);
}

export function isRenderedCommentTarget(element: HTMLElement): boolean {
  return isRenderedPageElement(element);
}

export function commentLayoutTargets(
  commentedTargets: readonly HtmlCanvasCommentedTarget[],
): HtmlCanvasCommentLayoutTarget[] {
  return commentedTargets.flatMap((rawTarget) => {
    const entries = rawTarget.layoutTargets ?? [{
      target: rawTarget.target,
      ...(rawTarget.visualHint ? { visualHint: rawTarget.visualHint } : {}),
    }];
    return entries.map((entry) => (
      "target" in entry
        ? entry
        : {
            target: entry,
            ...(entry.visualHint ? { visualHint: entry.visualHint } : {}),
          }
    ));
  });
}

export function sortedCommentLayoutTargetIds(
  targets: readonly HtmlCanvasCommentLayoutTarget[],
): string[] {
  return [...new Set(targets.map((entry) => entry.target.id))].sort();
}

export function naturalDocumentContentHeight(
  documentNode: Document,
  clientHeight: number,
): number {
  const scrollingElement = documentNode.scrollingElement || documentNode.documentElement;
  const documentElement = documentNode.documentElement;
  const body = documentNode.body;
  const renderedHeight = layoutHeightExcludingRootTransforms(
    documentElement,
    body,
  );
  const offsetHeight = Math.max(
    documentElement.offsetHeight,
    body.offsetHeight,
  );
  const scrollHeight = Math.max(
    scrollingElement.scrollHeight,
    documentElement.scrollHeight,
    body.scrollHeight,
  );
  return Math.max(
    0,
    Math.ceil(
      scrollHeight > clientHeight + 1
        ? Math.max(renderedHeight, offsetHeight, scrollHeight)
        : Math.max(renderedHeight, offsetHeight),
    ),
  );
}

function layoutHeightExcludingRootTransforms(
  documentElement: HTMLElement,
  body: HTMLElement,
): number {
  const transformOf = (element: HTMLElement) => {
    const transform = getComputedStyle(element).transform;
    return Boolean(transform && transform !== "none");
  };
  const zoomOf = (element: HTMLElement) => {
    const style = getComputedStyle(element) as CSSStyleDeclaration & { zoom?: string };
    const zoom = Number.parseFloat(style.zoom || "1");
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  };
  const documentZoom = zoomOf(documentElement);
  const bodyZoom = zoomOf(body);
  if (transformOf(documentElement) || transformOf(body) || documentZoom !== 1 || bodyZoom !== 1) {
    // getBoundingClientRect includes visual transforms, so a transformed root
    // would feed its scaled height back into the iframe and loop. offsetHeight
    // is a zoom-stable layout measurement and ignores transforms; never divide
    // it by zoom, or a shrinking zoom would inflate the measured height and
    // restart the ResizeObserver cycle.
    return Math.max(documentElement.offsetHeight, body.offsetHeight);
  }
  return Math.max(
    documentElement.getBoundingClientRect().height,
    body.getBoundingClientRect().height,
  );
}

export function tabAssociations(documentNode: Document): PageTabAssociation[] {
  return pageTabAssociations(documentNode);
}

export function tabAssociationForElement(
  element: HTMLElement,
  associations: readonly PageTabAssociation[],
): PageTabAssociation | null {
  return pageTabAssociationForElement(element, associations);
}

export function activateContainingTab(element: HTMLElement): boolean {
  return activatePageTabContaining(element);
}

function writeAriaState(
  element: HTMLElement,
  name: "aria-selected" | "aria-expanded",
  value: "true" | "false" | null,
) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function restorePageViewContext(
  documentNode: Document,
  sourceHtml: string,
  context: PageViewContext | null,
) {
  if (!context) return;
  const resolved = resolvePageViewContext(sourceHtml, context);
  for (const item of resolved.entries) {
    const element = pageViewContextElement(documentNode, item.sourceNodeId);
    if (!element) continue;
    if (item.sourceState.classTokens.length > 0) {
      element.setAttribute("class", item.sourceState.classTokens.join(" "));
    } else {
      element.removeAttribute("class");
    }
    element.toggleAttribute("hidden", item.sourceState.hidden);
    element.toggleAttribute("open", item.sourceState.open);
    writeAriaState(element, "aria-selected", (
      item.sourceState.ariaSelected === "true"
      || item.sourceState.ariaSelected === "false"
    ) ? item.sourceState.ariaSelected : null);
    writeAriaState(element, "aria-expanded", (
      item.sourceState.ariaExpanded === "true"
      || item.sourceState.ariaExpanded === "false"
    ) ? item.sourceState.ariaExpanded : null);
    element.removeAttribute(PAGE_VIEW_CONTEXT_ATTRIBUTE);
  }
}

export function applyPageViewContextToDocument(
  documentNode: Document,
  sourceHtml: string,
  nextContext: PageViewContext | null,
  previousContext: PageViewContext | null,
): number {
  restorePageViewContext(documentNode, sourceHtml, previousContext);
  if (!nextContext) return 0;
  const resolved = resolvePageViewContext(sourceHtml, nextContext);
  let applied = 0;
  for (const item of resolved.entries) {
    const element = pageViewContextElement(documentNode, item.sourceNodeId);
    if (!element) continue;
    const classNames = new Set(item.sourceState.classTokens);
    item.entry.classRemove.forEach((token) => classNames.delete(token));
    item.entry.classAdd.forEach((token) => classNames.add(token));
    if (classNames.size > 0) {
      element.setAttribute("class", [...classNames].join(" "));
    } else {
      element.removeAttribute("class");
    }
    if (item.entry.hidden !== undefined) {
      element.toggleAttribute("hidden", item.entry.hidden);
    }
    if (item.entry.open !== undefined) {
      element.toggleAttribute("open", item.entry.open);
    }
    if ("ariaSelected" in item.entry) {
      writeAriaState(
        element,
        "aria-selected",
        item.entry.ariaSelected ?? null,
      );
    }
    if ("ariaExpanded" in item.entry) {
      writeAriaState(
        element,
        "aria-expanded",
        item.entry.ariaExpanded ?? null,
      );
    }
    element.setAttribute(PAGE_VIEW_CONTEXT_ATTRIBUTE, "true");
    applied += 1;
  }
  return applied;
}
