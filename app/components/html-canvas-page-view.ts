import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import { resolvePageViewContext, type PageViewContext } from "../lib/page-view-context.js";
import {
  activatePageTabContaining,
  isRenderedPageElement,
  pageTabAssociationForElement,
  pageTabAssociations,
  type PageTabAssociation,
} from "../lib/page-presentation-dom";
import type { HtmlCanvasCommentedTarget, HtmlCanvasSelection } from "./HtmlCanvasEditor.types";

const PAGE_VIEW_CONTEXT_ATTRIBUTE = "data-pageroot-view-context";
const READ_ONLY_VISUAL_ATTRIBUTE = "data-pageroot-readonly-visual";
const READ_ONLY_VISUAL_HOST_ATTRIBUTE = "data-pageroot-readonly-visual-host";

export function escapedSourceNodeId(nodeId: string): string {
  return nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function pageViewContextElement(
  documentNode: Document,
  sourceNodeId: string,
): HTMLElement | null {
  const matches = documentNode.querySelectorAll<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}="${escapedSourceNodeId(sourceNodeId)}"]`,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function isRenderedCommentTarget(element: HTMLElement): boolean {
  return isRenderedPageElement(element);
}

export function commentLayoutTargets(
  commentedTargets: readonly HtmlCanvasCommentedTarget[],
): HtmlCanvasSelection[] {
  return commentedTargets.flatMap((rawTarget) => (
    rawTarget.layoutTargets ?? [rawTarget.target]
  ));
}

export function sortedCommentLayoutTargetIds(
  targets: readonly HtmlCanvasSelection[],
): string[] {
  return [...new Set(targets.map((target) => target.id))].sort();
}

export function naturalDocumentContentHeight(
  documentNode: Document,
  clientHeight: number,
): number {
  const scrollingElement = documentNode.scrollingElement || documentNode.documentElement;
  const offsetHeight = Math.max(
    documentNode.documentElement.offsetHeight,
    documentNode.body.offsetHeight,
  );
  const scrollHeight = Math.max(
    scrollingElement.scrollHeight,
    documentNode.documentElement.scrollHeight,
    documentNode.body.scrollHeight,
  );
  return Math.max(
    0,
    Math.ceil(
      scrollHeight > clientHeight + 1
        ? Math.max(offsetHeight, scrollHeight)
        : offsetHeight,
    ),
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
  documentNode.querySelectorAll<HTMLElement>(
    `[${READ_ONLY_VISUAL_ATTRIBUTE}]`,
  ).forEach((element) => element.remove());
  documentNode.querySelectorAll<HTMLElement>(
    `[${READ_ONLY_VISUAL_HOST_ATTRIBUTE}]`,
  ).forEach((element) => element.removeAttribute(READ_ONLY_VISUAL_HOST_ATTRIBUTE));
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
  for (const item of resolved.visuals) {
    const element = pageViewContextElement(documentNode, item.sourceNodeId);
    const hasAuthoredVisualContent = element
      ? Array.from(element.childNodes).some((node) => (
          node.nodeType === Node.ELEMENT_NODE
          || (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0)
        ))
      : true;
    if (!element || hasAuthoredVisualContent) continue;
    element.setAttribute(READ_ONLY_VISUAL_HOST_ATTRIBUTE, "true");
    if (item.visual.kind === "canvas-bitmap") {
      const image = documentNode.createElement("img");
      image.setAttribute(READ_ONLY_VISUAL_ATTRIBUTE, "canvas-bitmap");
      image.setAttribute("contenteditable", "false");
      image.setAttribute("aria-hidden", "true");
      image.setAttribute("alt", "");
      image.setAttribute("draggable", "false");
      image.width = item.visual.width;
      image.height = item.visual.height;
      image.src = item.visual.dataUrl;
      element.append(image);
      applied += 1;
      continue;
    }
    const parser = new (documentNode.defaultView?.DOMParser ?? DOMParser)();
    const parsedVisual = parser.parseFromString(
      `<table><tbody>${item.visual.html}</tbody></table>`,
      "text/html",
    );
    const projectedRows = Array.from(
      parsedVisual.querySelector("tbody")?.children ?? [],
    ).map((row) => documentNode.importNode(row, true));
    for (const row of projectedRows) {
      row.setAttribute(READ_ONLY_VISUAL_ATTRIBUTE, "table-body");
      row.setAttribute("contenteditable", "false");
    }
    element.append(...projectedRows);
    if (projectedRows.length > 0) applied += 1;
  }
  return applied;
}
