import { normalizeSourceText } from "../lib/source-index.js";
import {
  SOURCE_ELEMENT_ATTRIBUTE,
  grantEditorCreatedSourceElements,
  revokeRemovedSourceElements,
  sealEditorCreatedSourceElements,
  uniqueSourceElement,
} from "./html-canvas-source-authority.js";

const VERIFIED_PLANS = new WeakSet();

const UNSUPPORTED_IN_PLACE_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "col", "colgroup", "caption",
  "template", "slot", "iframe", "object", "embed", "applet", "script", "style", "link",
  "meta", "svg", "math", "html", "head", "body", "frameset", "frame", "noscript",
]);

const UNSUPPORTED_IN_PLACE_PARENT_TAGS = new Set(
  [...UNSUPPORTED_IN_PLACE_TAGS].filter((tag) => tag !== "body"),
);

function freezePlan(plan) {
  const frozen = Object.freeze({ ...plan });
  VERIFIED_PLANS.add(frozen);
  return frozen;
}

export function applyStructuralProjectionObservation(element, observation) {
  if (!element || !observation) return;
  const kind = observation.kind || "";
  const reason = observation.reason || "";
  const planned = observation.planned || kind;
  const outcome = observation.outcome || "";
  if (kind) element.setAttribute("data-structural-projection-kind", kind);
  if (reason) element.setAttribute("data-structural-projection-reason", reason);
  if (planned) element.setAttribute("data-structural-projection-planned", planned);
  if (outcome) element.setAttribute("data-structural-projection-outcome", outcome);
}

export function isVerifiedStructuralProjectionPlan(plan) {
  return Boolean(plan && typeof plan === "object" && VERIFIED_PLANS.has(plan));
}

export function isStructuralInPlaceEnabled(globalObject = globalThis) {
  return globalObject.__PAGEROOT_DISABLE_STRUCTURAL_IN_PLACE__ !== true;
}

export function isUnsupportedInPlaceTag(tagName) {
  const tag = String(tagName || "").toLowerCase();
  return !tag || UNSUPPORTED_IN_PLACE_TAGS.has(tag) || tag.includes("-");
}

export function isUnsupportedInPlaceParentTag(tagName) {
  const tag = String(tagName || "").toLowerCase();
  return !tag || UNSUPPORTED_IN_PLACE_PARENT_TAGS.has(tag) || tag.includes("-");
}

function attributeValue(element, name) {
  const attribute = element?.attributesByName?.get?.(name)?.[0];
  return String(attribute?.value || attribute?.rawValue || "").trim();
}

function hasCustomizedBuiltin(element) {
  return Boolean(attributeValue(element, "is"));
}

function isUnsupportedInPlaceHost(element) {
  return !element || isUnsupportedInPlaceTag(element.tagName) || hasCustomizedBuiltin(element);
}

function isUnsupportedInPlaceParent(element) {
  return !element
    || isUnsupportedInPlaceParentTag(element.tagName)
    || hasCustomizedBuiltin(element);
}

function parentHasSignificantMixedContent(index, parentId) {
  const parent = sourceElement(index, parentId);
  if (!parent) return true;
  return parent.childIds.some((childId) => {
    const child = index.byNodeId.get(childId);
    if (child?.type === "comment") return true;
    if (child?.type === "text") {
      return normalizeSourceText(child.value || "") !== "";
    }
    return false;
  });
}

function sourceElement(index, elementId) {
  if (!elementId) return null;
  const element = index.byPagerootId.get(elementId);
  return element?.type === "element" ? element : null;
}

function parentPagerootId(index, element) {
  if (!element?.parentId) return null;
  const parent = index.byNodeId.get(element.parentId);
  return parent?.type === "element" ? parent.pagerootId ?? null : null;
}

function addedRoots(delta, afterIndex) {
  const added = new Set(delta.addedElementIds);
  return delta.addedElementIds.filter((elementId) => {
    const element = sourceElement(afterIndex, elementId);
    const parentId = parentPagerootId(afterIndex, element);
    return Boolean(element) && !added.has(parentId || "");
  });
}

function removedRoots(delta, beforeIndex) {
  const removed = new Set(delta.removedElementIds);
  return delta.removedElementIds.filter((elementId) => {
    const element = sourceElement(beforeIndex, elementId);
    const parentId = parentPagerootId(beforeIndex, element);
    return Boolean(element) && !removed.has(parentId || "");
  });
}

export function resolveDeleteSelectionLanding(beforeIndex, removedRootElementId) {
  const target = sourceElement(beforeIndex, removedRootElementId);
  if (!target) return null;
  const next = target.nextElementSiblingId
    ? beforeIndex.byNodeId.get(target.nextElementSiblingId)
    : null;
  if (
    next?.type === "element"
    && next.pagerootId
    && !isUnsupportedInPlaceTag(next.tagName)
    && !["html", "head", "body"].includes(next.tagName)
  ) {
    return next.pagerootId;
  }
  const previous = target.previousElementSiblingId
    ? beforeIndex.byNodeId.get(target.previousElementSiblingId)
    : null;
  if (
    previous?.type === "element"
    && previous.pagerootId
    && !isUnsupportedInPlaceTag(previous.tagName)
    && !["html", "head", "body"].includes(previous.tagName)
  ) {
    return previous.pagerootId;
  }
  const parentId = parentPagerootId(beforeIndex, target);
  const parent = sourceElement(beforeIndex, parentId);
  if (
    parent?.pagerootId
    && !isUnsupportedInPlaceTag(parent.tagName)
    && !["html", "head", "body"].includes(parent.tagName)
  ) {
    return parent.pagerootId;
  }
  return null;
}

function subtreeHasUnsupportedTag(index, rootId) {
  const root = sourceElement(index, rootId);
  if (!root) return true;
  if (isUnsupportedInPlaceHost(root)) return true;
  const rootRange = root.range;
  if (!rootRange) {
    return root.childElementIds.some((childId) => {
      const child = index.byNodeId.get(childId);
      return child?.type === "element" && isUnsupportedInPlaceHost(child);
    });
  }
  return index.elements.some((element) => (
    element.type === "element"
    && element.range
    && element.range.startOffset >= rootRange.startOffset
    && element.range.endOffset <= rootRange.endOffset
    && isUnsupportedInPlaceHost(element)
  ));
}

function classifyAction(delta, operationType) {
  if (operationType === "replaceSubtree") return null;
  if (delta.tagChangedElementIds.length > 0) return null;
  if (
    delta.addedElementIds.length > 0
    && delta.removedElementIds.length === 0
    && delta.movedElementIds.length === 0
  ) return "insert";
  if (
    delta.removedElementIds.length > 0
    && delta.addedElementIds.length === 0
    && delta.movedElementIds.length === 0
  ) return "delete";
  if (
    delta.movedElementIds.length > 0
    && delta.addedElementIds.length === 0
    && delta.removedElementIds.length === 0
  ) return "move";
  return null;
}

export function decideStructuralProjection(context) {
  if (context.enabled === false || !isStructuralInPlaceEnabled()) {
    return { kind: "candidate", reason: "structural-in-place-disabled" };
  }
  if (context.programIdentityChanged) {
    return { kind: "candidate", reason: "program-identity-changed" };
  }
  const delta = context.identityDelta;
  if (!delta || delta.operationId !== context.operationId) {
    return { kind: "candidate", reason: "identity-delta-unbound" };
  }
  if (
    context.beforeIndex.sourceSha256 !== context.beforeSourceSha256
    || context.afterIndex.sourceSha256 !== context.afterSourceSha256
  ) {
    return { kind: "candidate", reason: "source-identity-mismatch" };
  }
  const action = classifyAction(delta, context.operationType);
  if (!action) {
    return { kind: "candidate", reason: "unsupported-identity-transition" };
  }

  if (action === "insert") {
    const roots = addedRoots(delta, context.afterIndex);
    if (roots.length !== 1) {
      return { kind: "candidate", reason: "insert-root-ambiguous" };
    }
    const rootId = roots[0];
    const afterRoot = sourceElement(context.afterIndex, rootId);
    const parentId = parentPagerootId(context.afterIndex, afterRoot);
    if (!afterRoot || !parentId || subtreeHasUnsupportedTag(context.afterIndex, rootId)) {
      return { kind: "candidate", reason: "insert-host-unsupported" };
    }
    const parent = sourceElement(context.afterIndex, parentId);
    if (isUnsupportedInPlaceParent(parent)) {
      return { kind: "candidate", reason: "insert-parent-unsupported" };
    }
    if (parentHasSignificantMixedContent(context.afterIndex, parentId)) {
      return { kind: "candidate", reason: "insert-mixed-content" };
    }
    const nextSibling = afterRoot.nextElementSiblingId
      ? context.afterIndex.byNodeId.get(afterRoot.nextElementSiblingId)
      : null;
    const beforeId = nextSibling?.type === "element" ? nextSibling.pagerootId ?? null : null;
    return {
      kind: "in-place",
      reason: "verified-insert",
      plan: freezePlan({
        operationId: context.operationId,
        beforeSourceSha256: context.beforeSourceSha256,
        afterSourceSha256: context.afterSourceSha256,
        frameGeneration: context.frameGeneration,
        executionId: context.executionId,
        action,
        identityDelta: delta,
        addedRootElementId: rootId,
        removedRootElementId: null,
        movedElementId: null,
        parentElementId: parentId,
        beforeElementId: beforeId,
        sourceParentElementId: parentId,
        selectionLandingElementId: rootId,
        fragmentHtml: afterRoot.raw ?? null,
        capabilityReason: "verified-insert",
      }),
    };
  }

  if (action === "delete") {
    const roots = removedRoots(delta, context.beforeIndex);
    if (roots.length !== 1) {
      return { kind: "candidate", reason: "delete-root-ambiguous" };
    }
    const rootId = roots[0];
    const beforeRoot = sourceElement(context.beforeIndex, rootId);
    const parentId = parentPagerootId(context.beforeIndex, beforeRoot);
    if (!beforeRoot || subtreeHasUnsupportedTag(context.beforeIndex, rootId)) {
      return { kind: "candidate", reason: "delete-host-unsupported" };
    }
    return {
      kind: "in-place",
      reason: "verified-delete",
      plan: freezePlan({
        operationId: context.operationId,
        beforeSourceSha256: context.beforeSourceSha256,
        afterSourceSha256: context.afterSourceSha256,
        frameGeneration: context.frameGeneration,
        executionId: context.executionId,
        action,
        identityDelta: delta,
        addedRootElementId: null,
        removedRootElementId: rootId,
        movedElementId: null,
        parentElementId: parentId,
        beforeElementId: null,
        sourceParentElementId: parentId,
        selectionLandingElementId: resolveDeleteSelectionLanding(context.beforeIndex, rootId),
        fragmentHtml: null,
        capabilityReason: "verified-delete",
      }),
    };
  }

  const movedId = delta.movedElementIds[0] || delta.targetElementId;
  if (!movedId || delta.movedElementIds.length === 0) {
    return { kind: "candidate", reason: "move-target-missing" };
  }
  const afterMoved = sourceElement(context.afterIndex, movedId);
  const beforeMoved = sourceElement(context.beforeIndex, movedId);
  const destParentId = parentPagerootId(context.afterIndex, afterMoved);
  const sourceParentId = parentPagerootId(context.beforeIndex, beforeMoved);
  if (
    !afterMoved
    || !beforeMoved
    || !destParentId
    || subtreeHasUnsupportedTag(context.afterIndex, movedId)
    || subtreeHasUnsupportedTag(context.beforeIndex, movedId)
  ) {
    return { kind: "candidate", reason: "move-host-unsupported" };
  }
  const destParent = sourceElement(context.afterIndex, destParentId);
  if (isUnsupportedInPlaceParent(destParent)) {
    return { kind: "candidate", reason: "move-parent-unsupported" };
  }
  if (parentHasSignificantMixedContent(context.afterIndex, destParentId)) {
    return { kind: "candidate", reason: "move-mixed-content" };
  }
  const nextSibling = afterMoved.nextElementSiblingId
    ? context.afterIndex.byNodeId.get(afterMoved.nextElementSiblingId)
    : null;
  const beforeId = nextSibling?.type === "element" ? nextSibling.pagerootId ?? null : null;
  return {
    kind: "in-place",
    reason: sourceParentId === destParentId ? "verified-same-parent-move" : "verified-cross-parent-move",
    plan: freezePlan({
      operationId: context.operationId,
      beforeSourceSha256: context.beforeSourceSha256,
      afterSourceSha256: context.afterSourceSha256,
      frameGeneration: context.frameGeneration,
      executionId: context.executionId,
      action: "move",
      identityDelta: delta,
      addedRootElementId: null,
      removedRootElementId: null,
      movedElementId: movedId,
      parentElementId: destParentId,
      beforeElementId: beforeId,
      sourceParentElementId: sourceParentId,
      selectionLandingElementId: movedId,
      fragmentHtml: null,
      capabilityReason: sourceParentId === destParentId
        ? "verified-same-parent-move"
        : "verified-cross-parent-move",
    }),
  };
}

function liveElement(documentNode, elementId) {
  if (!elementId) return null;
  return uniqueSourceElement(documentNode, elementId);
}

function collectSubtree(root, allowedIds) {
  const matches = [];
  if (allowedIds.has(root.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) || "")) {
    matches.push(root);
  }
  for (const child of Array.from(root.querySelectorAll(`[${SOURCE_ELEMENT_ATTRIBUTE}]`))) {
    const id = child.getAttribute(SOURCE_ELEMENT_ATTRIBUTE);
    if (id && allowedIds.has(id)) matches.push(child);
  }
  return matches;
}

function createFragmentFromNextSource(documentNode, nextHtml, rootId) {
  const view = documentNode.defaultView;
  if (!view?.DOMParser) return null;
  const parsed = new view.DOMParser().parseFromString(nextHtml, "text/html");
  const sourceRoot = uniqueSourceElement(parsed, rootId);
  if (!sourceRoot) return null;
  return documentNode.importNode(sourceRoot, true);
}

function placementMatches(element, parentId, beforeId) {
  const parent = element.parentElement;
  if (!parent || parent.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) !== parentId) return false;
  const next = element.nextElementSibling;
  const nextId = next?.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) || null;
  return (beforeId || null) === (nextId || null);
}

export function executeVerifiedStructuralProjection(options) {
  const { plan, nextHtml, afterIndex, live } = options;
  if (!isVerifiedStructuralProjectionPlan(plan)) {
    return { ok: false, reason: "plan-not-verified" };
  }
  if (
    live.frameGeneration !== plan.frameGeneration
    || live.executionId !== plan.executionId
    || afterIndex.sourceSha256 !== plan.afterSourceSha256
    || !live.documentNode
  ) {
    return { ok: false, reason: "live-identity-stale" };
  }
  const proved = live.isProvenSourceElement;

  if (plan.action === "insert" && plan.addedRootElementId) {
    const parent = liveElement(live.documentNode, plan.parentElementId);
    if (!parent || (proved && !proved(parent))) {
      return { ok: false, reason: "insert-parent-unproven" };
    }
    const fragment = createFragmentFromNextSource(
      live.documentNode,
      nextHtml,
      plan.addedRootElementId,
    );
    if (!fragment) return { ok: false, reason: "insert-fragment-unproven" };
    const before = plan.beforeElementId
      ? liveElement(live.documentNode, plan.beforeElementId)
      : null;
    if (plan.beforeElementId && (!before || (proved && !proved(before)))) {
      fragment.remove();
      return { ok: false, reason: "insert-before-unproven" };
    }
    const created = collectSubtree(fragment, new Set(plan.identityDelta.addedElementIds));
    const creationTicket = sealEditorCreatedSourceElements(created);
    parent.insertBefore(fragment, before);
    if (!placementMatches(fragment, plan.parentElementId || "", plan.beforeElementId)) {
      fragment.remove();
      return { ok: false, reason: "insert-placement-mismatch" };
    }
    if (live.authority) {
      const granted = grantEditorCreatedSourceElements({
        authority: live.authority,
        documentNode: live.documentNode,
        sourceIndex: afterIndex,
        expectedGeneration: plan.frameGeneration,
        expectedExecutionId: plan.executionId || "",
        createdElements: created,
        allowedElementIds: plan.identityDelta.addedElementIds,
        markerAttribute: live.markerAttribute,
        creationTicket,
      });
      if (!granted.ok) {
        fragment.remove();
        return { ok: false, reason: granted.reason };
      }
    }
    return { ok: true, selectedElementId: plan.selectionLandingElementId };
  }

  if (plan.action === "delete" && plan.removedRootElementId) {
    const target = liveElement(live.documentNode, plan.removedRootElementId);
    if (!target || (proved && !proved(target))) {
      return { ok: false, reason: "delete-target-unproven" };
    }
    const removed = collectSubtree(
      target,
      new Set(plan.identityDelta.removedElementIds),
    );
    target.remove();
    revokeRemovedSourceElements({
      authority: live.authority,
      removedElements: removed,
      markerAttribute: live.markerAttribute,
    });
    return { ok: true, selectedElementId: plan.selectionLandingElementId };
  }

  if (plan.action === "move" && plan.movedElementId && plan.parentElementId) {
    const target = liveElement(live.documentNode, plan.movedElementId);
    const destParent = liveElement(live.documentNode, plan.parentElementId);
    if (!target || (proved && !proved(target))) {
      return { ok: false, reason: "move-target-unproven" };
    }
    if (!destParent || (proved && !proved(destParent))) {
      return { ok: false, reason: "move-parent-unproven" };
    }
    if (target.contains(destParent)) {
      return { ok: false, reason: "move-cycle" };
    }
    const before = plan.beforeElementId
      ? liveElement(live.documentNode, plan.beforeElementId)
      : null;
    if (plan.beforeElementId && (!before || (proved && !proved(before)))) {
      return { ok: false, reason: "move-before-unproven" };
    }
    destParent.insertBefore(target, before);
    if (!placementMatches(target, plan.parentElementId, plan.beforeElementId)) {
      return { ok: false, reason: "move-placement-mismatch" };
    }
    return { ok: true, selectedElementId: plan.movedElementId };
  }

  return { ok: false, reason: "unsupported-live-action" };
}
