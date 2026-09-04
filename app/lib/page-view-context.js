import { buildSourceIndex } from "./source-index.js";
import {
  createTargetRef,
  resolveTargetRef,
} from "./target-resolver.js";

export const PAGE_VIEW_CONTEXT_PROTOCOL = "pageroot-page-view-context";
export const PAGE_VIEW_CONTEXT_VERSION = 2;

const MAX_SNAPSHOT_ENTRIES = 512;
const MAX_CONTEXT_ENTRIES = 64;
const MAX_PRESENTATION_TAB_COUNT = 24;
const MAX_CLASS_TOKENS = 128;
const MAX_QUALIFIED_CLASS_TOKENS = 8;
const MAX_CLASS_TOKEN_LENGTH = 96;
const EXCLUDED_TAGS = new Set([
  "html",
  "head",
  "body",
  "script",
  "style",
  "link",
  "meta",
  "base",
]);

function classTokens(value) {
  return String(value ?? "")
    .split(/[\t\n\f\r ]+/u)
    .filter((token) => (
      token.length > 0
      && token.length <= MAX_CLASS_TOKEN_LENGTH
      && !/[\u0000-\u001f\u007f]/u.test(token)
    ))
    .slice(0, MAX_CLASS_TOKENS);
}

function singleSourceAttribute(element, name) {
  const attributes = element.attributesByName.get(name) ?? [];
  if (attributes.length > 1) return { valid: false, present: false, value: null };
  if (attributes.length === 0) return { valid: true, present: false, value: null };
  return {
    valid: true,
    present: true,
    value: attributes[0].value ?? attributes[0].rawValue ?? "",
  };
}

function sourcePresentationState(element) {
  const classAttribute = singleSourceAttribute(element, "class");
  const hiddenAttribute = singleSourceAttribute(element, "hidden");
  const openAttribute = singleSourceAttribute(element, "open");
  const ariaSelectedAttribute = singleSourceAttribute(element, "aria-selected");
  const ariaExpandedAttribute = singleSourceAttribute(element, "aria-expanded");
  if (
    !classAttribute.valid
    || !hiddenAttribute.valid
    || !openAttribute.valid
    || !ariaSelectedAttribute.valid
    || !ariaExpandedAttribute.valid
  ) return null;
  return {
    classTokens: classTokens(classAttribute.value),
    hidden: hiddenAttribute.present,
    open: openAttribute.present,
    ariaSelected: ariaSelectedAttribute.present
      ? String(ariaSelectedAttribute.value)
      : null,
    ariaExpanded: ariaExpandedAttribute.present
      ? String(ariaExpandedAttribute.value)
      : null,
  };
}

function normalizedAriaBoolean(value) {
  if (value === null) return null;
  return value === "true" || value === "false" ? value : undefined;
}

function currentPresentationState(rawEntry) {
  if (
    typeof rawEntry?.className !== "string"
    || typeof rawEntry?.hidden !== "boolean"
    || typeof rawEntry?.open !== "boolean"
  ) return null;
  const ariaSelected = normalizedAriaBoolean(rawEntry.ariaSelected ?? null);
  const ariaExpanded = normalizedAriaBoolean(rawEntry.ariaExpanded ?? null);
  if (ariaSelected === undefined || ariaExpanded === undefined) return null;
  return {
    classTokens: classTokens(rawEntry.className),
    hidden: rawEntry.hidden,
    open: rawEntry.open,
    ariaSelected,
    ariaExpanded,
    visible: (
      rawEntry.hidden !== true
      && String(rawEntry.display ?? "").toLowerCase() !== "none"
      && !["hidden", "collapse"].includes(
        String(rawEntry.visibility ?? "").toLowerCase(),
      )
    ),
  };
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function frozenTargetRef(targetRef) {
  return Object.freeze({
    ...targetRef,
    sourceAnchor: targetRef.sourceAnchor
      ? Object.freeze({ ...targetRef.sourceAnchor })
      : undefined,
    fingerprint: targetRef.fingerprint
      ? Object.freeze({
          ...targetRef.fingerprint,
          stableAttributes: Object.freeze({
            ...(targetRef.fingerprint.stableAttributes ?? {}),
          }),
          ancestorFingerprint: Object.freeze([
            ...(targetRef.fingerprint.ancestorFingerprint ?? []),
          ]),
        })
      : undefined,
  });
}

function contextStateDiff(sourceState, currentState) {
  const hidden = sourceState.hidden === currentState.hidden
    ? undefined
    : currentState.hidden;
  const open = sourceState.open === currentState.open
    ? undefined
    : currentState.open;
  const ariaSelected = sourceState.ariaSelected === currentState.ariaSelected
    ? undefined
    : currentState.ariaSelected;
  const ariaExpanded = sourceState.ariaExpanded === currentState.ariaExpanded
    ? undefined
    : currentState.ariaExpanded;
  return {
    classAdd: difference(currentState.classTokens, sourceState.classTokens),
    classRemove: difference(sourceState.classTokens, currentState.classTokens),
    hidden,
    open,
    ariaSelected,
    ariaExpanded,
  };
}

function hasSemanticState(diff) {
  return diff.hidden !== undefined
    || diff.open !== undefined
    || diff.ariaSelected !== undefined
    || diff.ariaExpanded !== undefined;
}

function qualifyingClassTokens(candidates) {
  const changes = new Map();
  for (const candidate of candidates) {
    for (const token of candidate.diff.classAdd) {
      const change = changes.get(token) ?? {
        added: 0,
        removed: 0,
        visibility: new Set(),
      };
      change.added += 1;
      change.visibility.add(candidate.currentState.visible);
      changes.set(token, change);
    }
    for (const token of candidate.diff.classRemove) {
      const change = changes.get(token) ?? {
        added: 0,
        removed: 0,
        visibility: new Set(),
      };
      change.removed += 1;
      change.visibility.add(candidate.currentState.visible);
      changes.set(token, change);
    }
  }
  return new Set(
    [...changes.entries()]
      .filter(([, change]) => (
        change.added > 0
        && change.removed > 0
        && change.visibility.has(true)
        && change.visibility.has(false)
      ))
      .slice(0, MAX_QUALIFIED_CLASS_TOKENS)
      .map(([token]) => token),
  );
}

export function createPageViewContext({
  html,
  documentKey,
  generation,
  snapshot,
} = {}) {
  if (
    typeof html !== "string"
    || typeof documentKey !== "string"
    || documentKey.length === 0
    || documentKey.length > 8192
    || !Number.isInteger(generation)
    || generation < 0
    || snapshot?.protocol !== PAGE_VIEW_CONTEXT_PROTOCOL
    || snapshot?.version !== PAGE_VIEW_CONTEXT_VERSION
    || snapshot?.truncated === true
    || !Array.isArray(snapshot?.entries)
    || snapshot.entries.length > MAX_SNAPSHOT_ENTRIES
  ) return null;

  const sourceIndex = buildSourceIndex(html);
  if (snapshot.sourceSha256 !== sourceIndex.sourceSha256) return null;

  const sourceNodeCounts = new Map();
  for (const rawEntry of snapshot.entries) {
    const sourceNodeId = String(rawEntry?.sourceNodeId ?? "");
    sourceNodeCounts.set(sourceNodeId, (sourceNodeCounts.get(sourceNodeId) ?? 0) + 1);
  }

  const candidates = [];
  for (const rawEntry of snapshot.entries) {
    const sourceNodeId = String(rawEntry?.sourceNodeId ?? "");
    if (!sourceNodeId || sourceNodeCounts.get(sourceNodeId) !== 1) continue;
    const element = sourceIndex.byNodeId.get(sourceNodeId);
    if (
      !element
      || element.type !== "element"
      || EXCLUDED_TAGS.has(element.tagName)
    ) continue;
    const sourceState = sourcePresentationState(element);
    const currentState = currentPresentationState(rawEntry);
    if (!sourceState || !currentState) continue;
    const diff = contextStateDiff(sourceState, currentState);
    if (
      diff.classAdd.length === 0
      && diff.classRemove.length === 0
      && !hasSemanticState(diff)
    ) continue;
    candidates.push({
      element,
      currentState,
      diff,
    });
  }

  const allowedClassTokens = qualifyingClassTokens(candidates);
  const entries = [];
  for (const candidate of candidates) {
    const classAdd = candidate.diff.classAdd.filter(
      (token) => allowedClassTokens.has(token),
    );
    const classRemove = candidate.diff.classRemove.filter(
      (token) => allowedClassTokens.has(token),
    );
    if (
      classAdd.length === 0
      && classRemove.length === 0
      && !hasSemanticState(candidate.diff)
    ) continue;
    const targetRef = createTargetRef(sourceIndex, candidate.element, {
      level: "subregion",
    });
    entries.push(Object.freeze({
      targetRef: frozenTargetRef(targetRef),
      classAdd: Object.freeze(classAdd),
      classRemove: Object.freeze(classRemove),
      ...(candidate.diff.hidden !== undefined
        ? { hidden: candidate.diff.hidden }
        : {}),
      ...(candidate.diff.open !== undefined
        ? { open: candidate.diff.open }
        : {}),
      ...(candidate.diff.ariaSelected !== undefined
        ? { ariaSelected: candidate.diff.ariaSelected }
        : {}),
      ...(candidate.diff.ariaExpanded !== undefined
        ? { ariaExpanded: candidate.diff.ariaExpanded }
        : {}),
    }));
    if (entries.length >= MAX_CONTEXT_ENTRIES) break;
  }

  if (entries.length === 0) return null;
  return Object.freeze({
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    entries: Object.freeze(entries),
  });
}

export function resolvePageViewContext(html, context, suppliedSourceIndex = null) {
  const sourceIndex = suppliedSourceIndex?.source === html
    && Array.isArray(suppliedSourceIndex.elements)
    && suppliedSourceIndex.byNodeId instanceof Map
    ? suppliedSourceIndex
    : buildSourceIndex(html);
  return resolvePageViewContextFromIndex(sourceIndex, context);
}

function resolvePageViewContextFromIndex(sourceIndex, context) {
  if (
    context?.protocol !== PAGE_VIEW_CONTEXT_PROTOCOL
    || context?.version !== PAGE_VIEW_CONTEXT_VERSION
    || !Array.isArray(context?.entries)
    || context.entries.length > MAX_CONTEXT_ENTRIES
  ) {
    return { sourceIndex, entries: [] };
  }
  const entries = [];
  for (const entry of context.entries) {
    let resolution;
    try {
      resolution = resolveTargetRef(sourceIndex, entry.targetRef);
    } catch {
      continue;
    }
    if (
      !["exact", "rebound"].includes(resolution.resolution)
      || resolution.target?.type !== "element"
    ) continue;
    const sourceState = sourcePresentationState(resolution.target);
    if (!sourceState) continue;
    entries.push({
      entry,
      sourceNodeId: resolution.target.nodeId,
      resolution: resolution.resolution,
      sourceState,
    });
  }
  return { sourceIndex, entries };
}

function sourceAttribute(element, name) {
  const attribute = singleSourceAttribute(element, name);
  if (!attribute.valid) return { valid: false, present: false, value: null };
  return {
    valid: true,
    present: attribute.present,
    value: attribute.present ? String(attribute.value ?? "") : null,
  };
}

function normalizedSourceToken(element, name) {
  const attribute = sourceAttribute(element, name);
  if (!attribute.valid || !attribute.present) return null;
  const value = String(attribute.value ?? "").trim();
  return value && !/[\t\n\f\r ]/u.test(value) ? value : null;
}

function sourceRole(element) {
  return normalizedSourceToken(element, "role")?.toLowerCase() ?? null;
}

function sourceBooleanAria(element, name) {
  const value = normalizedSourceToken(element, name);
  return value === "true" || value === "false" ? value : null;
}

function sourceAttributeIsAbsent(element, name) {
  const attribute = sourceAttribute(element, name);
  return attribute.valid && !attribute.present;
}

function sourceAriaBooleanIsAbsentOrFalse(element, name) {
  const attribute = sourceAttribute(element, name);
  if (!attribute.valid) return false;
  if (!attribute.present) return true;
  return String(attribute.value ?? "").trim() === "false";
}

function sourceParent(sourceIndex, element) {
  const parent = element?.parentId
    ? sourceIndex.byNodeId.get(element.parentId)
    : null;
  return parent?.type === "element" ? parent : null;
}

function sourceAncestors(sourceIndex, element) {
  const ancestors = [];
  let candidate = sourceParent(sourceIndex, element);
  while (candidate) {
    ancestors.push(candidate);
    candidate = sourceParent(sourceIndex, candidate);
  }
  return ancestors;
}

function closestSourceElement(sourceIndex, element, predicate) {
  let candidate = element;
  while (candidate?.type === "element") {
    if (predicate(candidate)) return candidate;
    candidate = sourceParent(sourceIndex, candidate);
  }
  return null;
}

function sourceContains(sourceIndex, ancestor, candidate) {
  return sourceAncestors(sourceIndex, candidate).some(
    (item) => item.nodeId === ancestor.nodeId,
  );
}

function uniqueElementById(sourceIndex, id) {
  if (!id) return null;
  const matches = sourceIndex.elements.filter(
    (element) => normalizedSourceToken(element, "id") === id,
  );
  return matches.length === 1 ? matches[0] : null;
}

function sourceContentExists(sourceIndex, element, excludedNodeId = null) {
  return element.childIds.some((nodeId) => {
    if (nodeId === excludedNodeId) return false;
    const child = sourceIndex.byNodeId.get(nodeId);
    if (child?.type === "element") return true;
    return child?.type === "text" && String(child.value ?? "").trim().length > 0;
  });
}

function effectivePresentationState(sourceState, entry) {
  const classNames = new Set(sourceState.classTokens);
  entry?.classRemove?.forEach((token) => classNames.delete(token));
  entry?.classAdd?.forEach((token) => classNames.add(token));
  return {
    classTokens: [...classNames],
    hidden: entry?.hidden ?? sourceState.hidden,
    open: entry?.open ?? sourceState.open,
    ariaSelected: Object.hasOwn(entry ?? {}, "ariaSelected")
      ? entry.ariaSelected ?? null
      : sourceState.ariaSelected,
    ariaExpanded: Object.hasOwn(entry ?? {}, "ariaExpanded")
      ? entry.ariaExpanded ?? null
      : sourceState.ariaExpanded,
  };
}

function presentationStateMap(sourceIndex, context, documentKey) {
  if (
    context
    && (
      context.protocol !== PAGE_VIEW_CONTEXT_PROTOCOL
      || context.version !== PAGE_VIEW_CONTEXT_VERSION
      || context.documentKey !== documentKey
      || !Number.isInteger(context.generation)
      || context.generation < 0
      || !Array.isArray(context.entries)
      || context.entries.length > MAX_CONTEXT_ENTRIES
    )
  ) return null;
  const states = new Map();
  const resolved = resolvePageViewContextFromIndex(sourceIndex, context);
  if (
    context
    && resolved.entries.length !== context.entries.length
  ) return null;
  for (const item of resolved.entries) {
    if (states.has(item.sourceNodeId)) return null;
    states.set(
      item.sourceNodeId,
      effectivePresentationState(item.sourceState, item.entry),
    );
  }
  return Object.freeze({ states });
}

function effectiveStateFor(sourceIndex, states, element) {
  const sourceState = sourcePresentationState(element);
  if (!sourceState) return null;
  return states.get(element.nodeId) ?? {
    classTokens: [...sourceState.classTokens],
    hidden: sourceState.hidden,
    open: sourceState.open,
    ariaSelected: sourceState.ariaSelected,
    ariaExpanded: sourceState.ariaExpanded,
  };
}

function frozenContextEntry(sourceIndex, element, state) {
  const sourceState = sourcePresentationState(element);
  if (!sourceState) return null;
  const diff = contextStateDiff(sourceState, state);
  if (
    diff.classAdd.length === 0
    && diff.classRemove.length === 0
    && !hasSemanticState(diff)
  ) return null;
  return Object.freeze({
    targetRef: frozenTargetRef(createTargetRef(sourceIndex, element, {
      level: "subregion",
    })),
    classAdd: Object.freeze(diff.classAdd),
    classRemove: Object.freeze(diff.classRemove),
    ...(diff.hidden !== undefined ? { hidden: diff.hidden } : {}),
    ...(diff.open !== undefined ? { open: diff.open } : {}),
    ...(diff.ariaSelected !== undefined
      ? { ariaSelected: diff.ariaSelected }
      : {}),
    ...(diff.ariaExpanded !== undefined
      ? { ariaExpanded: diff.ariaExpanded }
      : {}),
  });
}

function contextFromPresentationStates({
  sourceIndex,
  states,
  documentKey,
  generation,
}) {
  const entries = [];
  for (const [nodeId, state] of states) {
    const element = sourceIndex.byNodeId.get(nodeId);
    if (element?.type !== "element") return undefined;
    const entry = frozenContextEntry(sourceIndex, element, state);
    if (entry) entries.push(entry);
    if (entries.length > MAX_CONTEXT_ENTRIES) return undefined;
  }
  if (entries.length === 0) return null;
  return Object.freeze({
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    documentKey,
    generation,
    sourceSha256: sourceIndex.sourceSha256,
    entries: Object.freeze(entries),
  });
}

function classStateIsUniform(states) {
  const signatures = new Set(states.map((state) => (
    [...state.classTokens].sort().join("\u0000")
  )));
  return signatures.size === 1;
}

function tabPanelId(tab) {
  const controlledId = normalizedSourceToken(tab, "aria-controls");
  if (controlledId) return controlledId;
  if (tab.tagName !== "a") return null;
  const href = sourceAttribute(tab, "href");
  if (!href.valid || !href.present) return null;
  const match = String(href.value ?? "").match(/^#([^#\t\n\f\r ]+)$/u);
  return match?.[1] ?? null;
}

function closestTabList(sourceIndex, element) {
  return closestSourceElement(
    sourceIndex,
    sourceParent(sourceIndex, element),
    (candidate) => sourceRole(candidate) === "tablist",
  );
}

function resolveTabAction({
  sourceIndex,
  states,
  target,
  documentKey,
  generation,
}) {
  const control = closestSourceElement(
    sourceIndex,
    target,
    (candidate) => sourceRole(candidate) === "tab",
  );
  if (
    !control
    || !sourceAttributeIsAbsent(control, "disabled")
    || !sourceAriaBooleanIsAbsentOrFalse(control, "aria-disabled")
    || !sourceAttributeIsAbsent(control, "aria-haspopup")
    || !sourceAttributeIsAbsent(control, "popovertarget")
    || sourceAncestors(sourceIndex, control).some(
      (ancestor) => ancestor.tagName === "form",
    )
  ) return null;
  const tabList = closestTabList(sourceIndex, control);
  if (!tabList) return null;
  const tabs = sourceIndex.elements.filter((candidate) => (
    sourceRole(candidate) === "tab"
    && closestTabList(sourceIndex, candidate)?.nodeId === tabList.nodeId
  ));
  if (
    tabs.length < 2
    || tabs.length > MAX_PRESENTATION_TAB_COUNT
    || !tabs.some((tab) => tab.nodeId === control.nodeId)
  ) return null;

  const panels = [];
  const seenPanelIds = new Set();
  for (const tab of tabs) {
    const panelId = tabPanelId(tab);
    const panel = uniqueElementById(sourceIndex, panelId);
    if (
      !panelId
      || !panel
      || seenPanelIds.has(panelId)
      || sourceRole(panel) !== "tabpanel"
      || sourceContains(sourceIndex, tabList, panel)
      || sourceContains(sourceIndex, panel, tabList)
      || !sourceContentExists(sourceIndex, panel)
      || sourceBooleanAria(tab, "aria-selected") === null
    ) return null;
    seenPanelIds.add(panelId);
    panels.push(panel);
  }

  const tabStates = tabs.map((tab) => effectiveStateFor(sourceIndex, states, tab));
  const panelStates = panels.map((panel) => effectiveStateFor(sourceIndex, states, panel));
  if (
    tabStates.some((state) => !state)
    || panelStates.some((state) => !state)
    || !classStateIsUniform(tabStates)
    || !classStateIsUniform(panelStates)
  ) return null;
  const selectedIndexes = tabStates.flatMap((state, index) => (
    state.ariaSelected === "true" ? [index] : []
  ));
  const visibleIndexes = panelStates.flatMap((state, index) => (
    state.hidden === false ? [index] : []
  ));
  if (
    selectedIndexes.length !== 1
    || visibleIndexes.length !== 1
    || selectedIndexes[0] !== visibleIndexes[0]
    || tabStates.some((state) => (
      state.ariaSelected !== "true" && state.ariaSelected !== "false"
    ))
  ) return null;

  const targetIndex = tabs.findIndex((tab) => tab.nodeId === control.nodeId);
  const isCurrent = selectedIndexes[0] === targetIndex;
  if (!isCurrent) {
    tabs.forEach((tab, index) => {
      states.set(tab.nodeId, {
        ...tabStates[index],
        ariaSelected: index === targetIndex ? "true" : "false",
      });
    });
    panels.forEach((panel, index) => {
      states.set(panel.nodeId, {
        ...panelStates[index],
        hidden: index !== targetIndex,
      });
    });
  }
  const nextContext = contextFromPresentationStates({
    sourceIndex,
    states,
    documentKey,
    generation,
  });
  if (nextContext === undefined) return null;
  return Object.freeze({
    kind: "activate-tab",
    label: isCurrent ? "当前页签" : "切换到此页签",
    isCurrent,
    nextContext,
  });
}

function resolveDetailsAction({
  sourceIndex,
  states,
  target,
  documentKey,
  generation,
}) {
  const summary = closestSourceElement(
    sourceIndex,
    target,
    (candidate) => candidate.tagName === "summary",
  );
  const details = summary ? sourceParent(sourceIndex, summary) : null;
  if (!summary || details?.tagName !== "details") return null;
  const summaries = details.childElementIds
    .map((nodeId) => sourceIndex.byNodeId.get(nodeId))
    .filter((candidate) => candidate?.type === "element" && candidate.tagName === "summary");
  if (
    summaries.length !== 1
    || summaries[0].nodeId !== summary.nodeId
    || !sourceAttributeIsAbsent(details, "name")
    || !sourceContentExists(sourceIndex, details, summary.nodeId)
  ) return null;
  const state = effectiveStateFor(sourceIndex, states, details);
  if (!state) return null;
  states.set(details.nodeId, {
    ...state,
    open: !state.open,
  });
  const nextContext = contextFromPresentationStates({
    sourceIndex,
    states,
    documentKey,
    generation,
  });
  if (nextContext === undefined) return null;
  return Object.freeze({
    kind: "toggle-details",
    label: state.open ? "收起内容" : "展开内容",
    isCurrent: false,
    nextContext,
  });
}

function disclosureContainer(sourceIndex, control) {
  const parent = sourceParent(sourceIndex, control);
  if (!parent) return null;
  if (/^h[1-6]$/u.test(parent.tagName)) {
    return sourceParent(sourceIndex, parent);
  }
  return parent;
}

function disclosureAnchor(sourceIndex, control) {
  const parent = sourceParent(sourceIndex, control);
  return parent && /^h[1-6]$/u.test(parent.tagName) ? parent : control;
}

function resolveDisclosureAction({
  sourceIndex,
  states,
  target,
  documentKey,
  generation,
}) {
  const control = closestSourceElement(
    sourceIndex,
    target,
    (candidate) => (
      candidate.tagName === "button"
      && sourceBooleanAria(candidate, "aria-expanded") !== null
      && normalizedSourceToken(candidate, "aria-controls")
    ),
  );
  if (
    !control
    || !sourceAttributeIsAbsent(control, "disabled")
    || !sourceAriaBooleanIsAbsentOrFalse(control, "aria-disabled")
    || !sourceAttributeIsAbsent(control, "aria-haspopup")
    || !sourceAttributeIsAbsent(control, "popovertarget")
    || sourceAncestors(sourceIndex, control).some(
      (ancestor) => ancestor.tagName === "form",
    )
  ) return null;
  const controlId = normalizedSourceToken(control, "id");
  const panelId = normalizedSourceToken(control, "aria-controls");
  const panel = uniqueElementById(sourceIndex, panelId);
  if (
    !controlId
    || uniqueElementById(sourceIndex, controlId)?.nodeId !== control.nodeId
    || !panel
    || sourceRole(panel) !== "region"
    || normalizedSourceToken(panel, "aria-labelledby") !== controlId
    || panel.tagName === "aside"
    || !sourceAttributeIsAbsent(panel, "popover")
    || !sourceAriaBooleanIsAbsentOrFalse(panel, "aria-modal")
    || sourceContains(sourceIndex, control, panel)
    || sourceContains(sourceIndex, panel, control)
    || !sourceContentExists(sourceIndex, panel)
  ) return null;
  const container = disclosureContainer(sourceIndex, control);
  const anchor = disclosureAnchor(sourceIndex, control);
  if (
    !container
    || ["html", "body"].includes(container.tagName)
    || panel.parentId !== container.nodeId
    || anchor.nextElementSiblingId !== panel.nodeId
  ) return null;
  const controlState = effectiveStateFor(sourceIndex, states, control);
  const panelState = effectiveStateFor(sourceIndex, states, panel);
  if (
    !controlState
    || !panelState
    || !["true", "false"].includes(controlState.ariaExpanded)
    || panelState.hidden !== (controlState.ariaExpanded === "false")
  ) return null;
  const expanded = controlState.ariaExpanded === "true";
  states.set(control.nodeId, {
    ...controlState,
    ariaExpanded: expanded ? "false" : "true",
  });
  states.set(panel.nodeId, {
    ...panelState,
    hidden: expanded,
  });
  const nextContext = contextFromPresentationStates({
    sourceIndex,
    states,
    documentKey,
    generation,
  });
  if (nextContext === undefined) return null;
  return Object.freeze({
    kind: "toggle-disclosure",
    label: expanded ? "收起内容" : "展开内容",
    isCurrent: false,
    nextContext,
  });
}

export function createPagePresentationAction({
  html,
  sourceIndex: providedSourceIndex,
  documentKey,
  generation = 0,
  currentContext = null,
  targetRef,
} = {}) {
  if (
    typeof html !== "string"
    || typeof documentKey !== "string"
    || documentKey.length === 0
    || documentKey.length > 8192
    || !Number.isInteger(generation)
    || generation < 0
    || !targetRef
  ) return null;
  let sourceIndex = providedSourceIndex;
  if (!sourceIndex || sourceIndex.source !== html) {
    try {
      sourceIndex = buildSourceIndex(html);
    } catch {
      return null;
    }
  }
  let resolution;
  try {
    resolution = resolveTargetRef(sourceIndex, targetRef);
  } catch {
    return null;
  }
  if (
    !["exact", "rebound"].includes(resolution.resolution)
    || resolution.target?.type !== "element"
  ) return null;
  let presentation;
  try {
    presentation = presentationStateMap(
      sourceIndex,
      currentContext,
      documentKey,
    );
  } catch {
    return null;
  }
  if (!presentation) return null;
  const options = {
    sourceIndex,
    states: presentation.states,
    target: resolution.target,
    documentKey,
    generation: currentContext?.generation ?? generation,
  };
  return resolveTabAction(options)
    ?? resolveDetailsAction(options)
    ?? resolveDisclosureAction(options);
}
