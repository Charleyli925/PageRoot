import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import { resolvePageViewContext, type PageViewContext } from "../lib/page-view-context.js";
import type { HtmlCanvasCommentedTarget, HtmlCanvasSelection } from "./HtmlCanvasEditor.types";

const PAGE_VIEW_CONTEXT_ATTRIBUTE = "data-pageroot-view-context";

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

type TabAssociation = {
  panel: HTMLElement;
  control: HTMLElement;
  key: string;
  label: string;
};

const TAB_STATE_CLASS_NAMES = new Set([
  "active",
  "is-active",
  "selected",
  "current",
]);

export function isRenderedCommentTarget(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden]")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (
    style?.display === "none"
    || style?.visibility === "hidden"
    || style?.visibility === "collapse"
  ) return false;
  return element.getClientRects().length > 0;
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

function controlledPanelIds(control: HTMLElement): string[] {
  const values = [
    control.getAttribute("aria-controls"),
    control.getAttribute("data-p"),
    control.getAttribute("data-tab"),
    control.getAttribute("href"),
  ];
  const ids = new Set<string>();
  for (const value of values) {
    for (const token of String(value ?? "").split(/\s+/u)) {
      const normalized = token.trim().replace(/^#/u, "");
      if (normalized && !/[\s"'<>]/u.test(normalized)) ids.add(normalized);
    }
  }
  return [...ids];
}

type SiblingClassGroup = {
  parent: HTMLElement;
  members: HTMLElement[];
};

function stableSiblingClassKeys(element: HTMLElement): string[] {
  return [...element.classList]
    .filter((token) => !TAB_STATE_CLASS_NAMES.has(token))
    .sort()
    .map((token) => `${element.tagName.toLowerCase()}:${token}`);
}

function siblingClassGroups(documentNode: Document): SiblingClassGroup[] {
  const parents = new Set<HTMLElement>();
  documentNode.querySelectorAll<HTMLElement>("[class]").forEach((element) => {
    if (element.parentElement) parents.add(element.parentElement);
  });
  const groups: SiblingClassGroup[] = [];
  for (const parent of parents) {
    const byClass = new Map<string, HTMLElement[]>();
    const children = Array.from(parent.children) as HTMLElement[];
    for (const child of children) {
      for (const key of stableSiblingClassKeys(child)) {
        const members = byClass.get(key);
        if (members) members.push(child);
        else byClass.set(key, [child]);
      }
    }
    const seenMemberSets = new Set<string>();
    for (const members of byClass.values()) {
      if (members.length < 2 || members.length > 16) continue;
      const memberSetKey = members
        .map((member) => children.indexOf(member))
        .join(",");
      if (seenMemberSets.has(memberSetKey)) continue;
      seenMemberSets.add(memberSetKey);
      groups.push({ parent, members });
    }
  }
  return groups;
}

function isIndexedTabControl(element: HTMLElement): boolean {
  return element.getAttribute("role") === "tab"
    || element.hasAttribute("onclick")
    || element.hasAttribute("data-p")
    || element.hasAttribute("data-tab")
    || ["BUTTON", "A"].includes(element.tagName);
}

function hasIndexedTabActiveState(element: HTMLElement): boolean {
  return element.getAttribute("aria-selected") === "true"
    || [...TAB_STATE_CLASS_NAMES].some((className) => (
      element.classList.contains(className)
    ));
}

function relatedTabGroupParents(
  controlParent: HTMLElement,
  panelParent: HTMLElement,
): boolean {
  return controlParent === panelParent
    || controlParent.parentElement === panelParent
    || (
      controlParent.parentElement !== null
      && controlParent.parentElement === panelParent.parentElement
    );
}

function inferredIndexedTabAssociations(
  documentNode: Document,
  existing: readonly TabAssociation[],
): TabAssociation[] {
  const groups = siblingClassGroups(documentNode);
  const documentOrder = new Map<HTMLElement, number>(
    [...documentNode.querySelectorAll<HTMLElement>("body *")]
      .map((element, index) => [element, index]),
  );
  const controlGroups = groups.filter((group) => (
    group.members.every((element) => (
      isIndexedTabControl(element) && isRenderedCommentTarget(element)
    ))
  ));
  const panelGroups = groups.filter((group) => {
    if (
      group.members.some((element) => existing.some((entry) => entry.panel === element))
      || !group.members.every((element) => (
        element.hasAttribute(SOURCE_NODE_ATTRIBUTE)
        && !isIndexedTabControl(element)
      ))
    ) return false;
    const visibleCount = group.members.filter(isRenderedCommentTarget).length;
    return visibleCount === 1;
  });

  const associations: TabAssociation[] = [];
  for (const panels of panelGroups) {
    const firstPanelIndex = documentOrder.get(panels.members[0]) ?? Number.MAX_SAFE_INTEGER;
    const visiblePanelIndex = panels.members.findIndex(isRenderedCommentTarget);
    const controls = controlGroups
      .filter((candidate) => (
        candidate.members.length === panels.members.length
        && relatedTabGroupParents(candidate.parent, panels.parent)
        && (documentOrder.get(candidate.members.at(-1)!) ?? -1) < firstPanelIndex
        && candidate.members.filter(hasIndexedTabActiveState).length === 1
        && candidate.members.findIndex(hasIndexedTabActiveState) === visiblePanelIndex
      ))
      .sort((left, right) => {
        const leftDistance = firstPanelIndex
          - (documentOrder.get(left.members.at(-1)!) ?? 0);
        const rightDistance = firstPanelIndex
          - (documentOrder.get(right.members.at(-1)!) ?? 0);
        return leftDistance - rightDistance;
      })[0];
    if (!controls) continue;
    panels.members.forEach((panel, index) => {
      const control = controls.members[index];
      const label = (control.textContent ?? "").replace(/\s+/gu, " ").trim();
      associations.push({
        panel,
        control,
        key: panel.getAttribute(SOURCE_NODE_ATTRIBUTE) || panel.id,
        label: label || panel.getAttribute("aria-label") || "其他标签页",
      });
    });
  }
  return associations;
}

export function tabAssociations(documentNode: Document): TabAssociation[] {
  const associations: TabAssociation[] = [];
  const controls = documentNode.querySelectorAll<HTMLElement>(
    [
      '[role="tab"][aria-controls]',
      '[role="tab"][href^="#"]',
      "[data-p]",
      "[data-tab]",
    ].join(", "),
  );
  for (const control of controls) {
    for (const panelId of controlledPanelIds(control)) {
      const panel = documentNode.getElementById(panelId);
      if (!panel) continue;
      const label = (control.textContent ?? "").replace(/\s+/gu, " ").trim();
      associations.push({
        panel,
        control,
        key: panel.getAttribute(SOURCE_NODE_ATTRIBUTE) || panel.id || panelId,
        label: label || panel.getAttribute("aria-label") || "其他标签页",
      });
    }
  }
  for (const panel of documentNode.querySelectorAll<HTMLElement>(
    '[role="tabpanel"][aria-labelledby]',
  )) {
    const labelledBy = panel.getAttribute("aria-labelledby");
    if (!labelledBy || associations.some((entry) => entry.panel === panel)) continue;
    const control = documentNode.getElementById(labelledBy);
    if (!control) continue;
    associations.push({
      panel,
      control,
      key: panel.getAttribute(SOURCE_NODE_ATTRIBUTE) || panel.id || labelledBy,
      label: (control.textContent ?? "").replace(/\s+/gu, " ").trim()
        || panel.getAttribute("aria-label")
      || "其他标签页",
    });
  }
  associations.push(...inferredIndexedTabAssociations(documentNode, associations));
  return associations;
}

export function tabAssociationForElement(
  element: HTMLElement,
  associations: readonly TabAssociation[],
): TabAssociation | null {
  let candidate: HTMLElement | null = element;
  while (candidate) {
    const association = associations.find((entry) => entry.panel === candidate);
    if (association) return association;
    candidate = candidate.parentElement;
  }
  return null;
}

export function activateContainingTab(element: HTMLElement): boolean {
  const associations = tabAssociations(element.ownerDocument);
  const target = tabAssociationForElement(element, associations);
  if (!target) return false;
  const controlParent = target.control.parentElement;
  const group = associations.filter((entry) => (
    entry.control.parentElement === controlParent
  ));
  if (group.length < 2) return false;
  const stateClasses = [...TAB_STATE_CLASS_NAMES].filter(
    (className) => group.some((entry) => (
      entry.control.classList.contains(className)
      || entry.panel.classList.contains(className)
    )),
  );
  for (const entry of group) {
    const active = entry === target;
    for (const className of stateClasses) {
      entry.control.classList.toggle(className, active);
      entry.panel.classList.toggle(className, active);
    }
    if (
      entry.control.hasAttribute("aria-selected")
      || entry.control.getAttribute("role") === "tab"
    ) {
      entry.control.setAttribute("aria-selected", String(active));
    }
    if (
      entry.control.hasAttribute("tabindex")
      || entry.control.getAttribute("role") === "tab"
    ) {
      entry.control.tabIndex = active ? 0 : -1;
    }
    entry.panel.toggleAttribute("hidden", !active);
  }
  return isRenderedCommentTarget(element);
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
