import { PAGEROOT_ELEMENT_ID_ATTRIBUTE } from "../../shared/pageroot-element-identity.mjs";

export type PageTabAssociation = {
  panel: HTMLElement;
  control: HTMLElement;
  key: string;
  label: string;
  groupKey: string;
};

export const PAGE_TAB_STATE_CLASS_NAMES = [
  "active",
  "is-active",
  "selected",
  "current",
] as const;

const PAGE_TAB_STATE_CLASS_NAME_SET = new Set<string>(PAGE_TAB_STATE_CLASS_NAMES);

export function isRenderedPageElement(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden]")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (
    style?.display === "none"
    || style?.visibility === "hidden"
    || style?.visibility === "collapse"
  ) return false;
  return element.getClientRects().length > 0;
}

function isMarkupVisiblePageElement(element: HTMLElement): boolean {
  if (element.closest("[hidden]") || element.getAttribute("aria-hidden") === "true") return false;
  const inlineStyle = element.getAttribute("style") || "";
  return !/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:;|$)/iu
    .test(inlineStyle);
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
    .filter((token) => !PAGE_TAB_STATE_CLASS_NAME_SET.has(token))
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
    || element.hasAttribute("aria-controls")
    || element.hasAttribute("data-p")
    || element.hasAttribute("data-tab")
    || ["BUTTON", "A"].includes(element.tagName);
}

function hasIndexedTabActiveState(element: HTMLElement): boolean {
  return element.getAttribute("aria-selected") === "true"
    || PAGE_TAB_STATE_CLASS_NAMES.some((className) => (
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

function associationKey(panel: HTMLElement, fallback: string): string {
  return panel.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)
    || panel.id
    || panel.getAttribute("data-page")
    || panel.getAttribute("data-panel")
    || fallback;
}

function inferredIndexedTabAssociations(
  documentNode: Document,
  existing: readonly PageTabAssociation[],
  nextGroupIndex: number,
  isVisible: (element: HTMLElement) => boolean,
  requireSourceBackedPanels: boolean,
): PageTabAssociation[] {
  const groups = siblingClassGroups(documentNode);
  const documentOrder = new Map<HTMLElement, number>(
    [...documentNode.querySelectorAll<HTMLElement>("body *")]
      .map((element, index) => [element, index]),
  );
  const controlGroups = groups.filter((group) => (
    group.members.every((element) => (
      isIndexedTabControl(element) && isVisible(element)
    ))
  ));
  const panelGroups = groups.filter((group) => {
    if (
      group.members.some((element) => existing.some((entry) => entry.panel === element))
      || !group.members.every((element) => (
        !isIndexedTabControl(element)
        && (!requireSourceBackedPanels || element.hasAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE))
      ))
    ) return false;
    return group.members.filter(isVisible).length === 1
      || group.members.filter(hasIndexedTabActiveState).length === 1;
  });

  const associations: PageTabAssociation[] = [];
  for (const panels of panelGroups) {
    const firstPanelIndex = documentOrder.get(panels.members[0]) ?? Number.MAX_SAFE_INTEGER;
    const visibleMembers = panels.members.filter(isVisible);
    const visiblePanelIndex = visibleMembers.length === 1
      ? panels.members.indexOf(visibleMembers[0])
      : panels.members.findIndex(hasIndexedTabActiveState);
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
    const groupKey = `tab-group-${nextGroupIndex + associations.length + 1}`;
    panels.members.forEach((panel, index) => {
      const control = controls.members[index];
      const label = (control.textContent ?? "").replace(/\s+/gu, " ").trim();
      associations.push({
        panel,
        control,
        key: associationKey(panel, `${groupKey}-${index + 1}`),
        label: label || panel.getAttribute("aria-label") || "其他标签页",
        groupKey,
      });
    });
  }
  return associations;
}

/**
 * Shared live-DOM discovery for comments and formal review. The edit adapter
 * intentionally keeps its stricter source-index resolver and only consumes
 * the same product contract; it must never execute authored handlers.
 */
export function pageTabAssociations(
  documentNode: Document,
  options: { detached?: boolean; requireSourceBackedPanels?: boolean } = {},
): PageTabAssociation[] {
  const associations: PageTabAssociation[] = [];
  const groupKeys = new Map<HTMLElement, string>();
  const groupKeyFor = (control: HTMLElement, panel: HTMLElement) => {
    const owner = control.parentElement || panel.parentElement || documentNode.body;
    const existing = groupKeys.get(owner);
    if (existing) return existing;
    const key = `tab-group-${groupKeys.size + 1}`;
    groupKeys.set(owner, key);
    return key;
  };
  const controls = documentNode.querySelectorAll<HTMLElement>([
    '[role="tab"][aria-controls]',
    '[role="tab"][href^="#"]',
    '[aria-controls]:is(button, a, [role="button"])',
    "[data-p]",
    "[data-tab]",
  ].join(", "));
  for (const control of controls) {
    for (const panelId of controlledPanelIds(control)) {
      const panel = documentNode.getElementById(panelId);
      if (!(panel instanceof HTMLElement)) continue;
      const label = (control.textContent ?? "").replace(/\s+/gu, " ").trim();
      associations.push({
        panel,
        control,
        key: associationKey(panel, panelId),
        label: label || panel.getAttribute("aria-label") || "其他标签页",
        groupKey: groupKeyFor(control, panel),
      });
    }
  }
  for (const panel of documentNode.querySelectorAll<HTMLElement>(
    '[role="tabpanel"][aria-labelledby]',
  )) {
    const labelledBy = panel.getAttribute("aria-labelledby");
    if (!labelledBy || associations.some((entry) => entry.panel === panel)) continue;
    const control = documentNode.getElementById(labelledBy);
    if (!(control instanceof HTMLElement)) continue;
    associations.push({
      panel,
      control,
      key: associationKey(panel, labelledBy),
      label: (control.textContent ?? "").replace(/\s+/gu, " ").trim()
        || panel.getAttribute("aria-label")
        || "其他标签页",
      groupKey: groupKeyFor(control, panel),
    });
  }
  associations.push(...inferredIndexedTabAssociations(
    documentNode,
    associations,
    groupKeys.size,
    options.detached ? isMarkupVisiblePageElement : isRenderedPageElement,
    options.requireSourceBackedPanels ?? !options.detached,
  ));
  return associations;
}

export function pageTabAssociationForElement(
  element: HTMLElement,
  associations: readonly PageTabAssociation[],
): PageTabAssociation | null {
  let candidate: HTMLElement | null = element;
  while (candidate) {
    const association = associations.find((entry) => entry.panel === candidate);
    if (association) return association;
    candidate = candidate.parentElement;
  }
  return null;
}

export function activatePageTabContaining(element: HTMLElement): boolean {
  const associations = pageTabAssociations(element.ownerDocument);
  const target = pageTabAssociationForElement(element, associations);
  if (!target) return false;
  const group = associations.filter((entry) => entry.groupKey === target.groupKey);
  if (group.length < 2) return false;
  const stateClasses = PAGE_TAB_STATE_CLASS_NAMES.filter(
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
    ) entry.control.setAttribute("aria-selected", String(active));
    if (
      entry.control.hasAttribute("tabindex")
      || entry.control.getAttribute("role") === "tab"
    ) entry.control.tabIndex = active ? 0 : -1;
    entry.panel.toggleAttribute("hidden", !active);
  }
  return isRenderedPageElement(element);
}
