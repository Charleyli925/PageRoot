import {
  EditableIslandError,
  HTML_NAMESPACE,
  IMMUTABLE_EMBED_TAGS,
  INLINE_CONTENT_TAGS,
  ROOT_BLOCKED_TAGS,
  editableIslandDraftHtml,
  materializeEditableIslandHtml,
  normalizeEditableIslandHtml,
  normalizeEditableTextFragmentHtml,
} from "../../shared/editable-island.mjs";
import { resolveTargetRef } from "./target-resolver.js";

export {
  EditableIslandError,
  editableIslandDraftHtml,
  materializeEditableIslandHtml,
  normalizeEditableIslandHtml,
  normalizeEditableTextFragmentHtml,
};

function fail(code, message, details = {}) {
  throw new EditableIslandError(code, message, details);
}
function sourceDescendants(index, element) {
  const descendants = [];
  const pending = [...element.childIds];
  while (pending.length > 0) {
    const node = index.byNodeId.get(pending.shift());
    if (!node) continue;
    descendants.push(node);
    if (
      node.type !== "element"
      || !IMMUTABLE_EMBED_TAGS.has(node.tagName)
    ) {
      pending.unshift(...(node.childIds ?? []));
    }
  }
  return descendants;
}

export function editableIslandForTarget(index, targetRef) {
  const resolution = resolveTargetRef(index, targetRef);
  const element = resolution.target;
  if (resolution.resolution !== "exact" || element?.type !== "element") {
    fail(
      resolution.resolution === "ambiguous"
        ? "EDITABLE_ISLAND_TARGET_AMBIGUOUS"
        : "EDITABLE_ISLAND_TARGET_ORPHANED",
      "Editable island target is not an exact source element.",
      { resolution: resolution.resolution },
    );
  }
  if (
    element.namespaceURI !== HTML_NAMESPACE
    || element.isVoid
    || !element.explicitEndTag
    || ROOT_BLOCKED_TAGS.has(element.tagName)
  ) {
    fail(
      "EDITABLE_ISLAND_ROOT_UNSUPPORTED",
      `The <${element.tagName}> element cannot own a V2 editable island.`,
      { nodeId: element.nodeId, tagName: element.tagName },
    );
  }

  for (const descendant of sourceDescendants(index, element)) {
    if (
      descendant.type === "element"
      && (
        (
          descendant.namespaceURI === HTML_NAMESPACE
          && !INLINE_CONTENT_TAGS.has(descendant.tagName)
          && !IMMUTABLE_EMBED_TAGS.has(descendant.tagName)
        )
      )
    ) {
      fail(
        "EDITABLE_ISLAND_STRUCTURE_UNSUPPORTED",
        `The island contains unsupported <${descendant.tagName}> structure.`,
        { nodeId: descendant.nodeId, tagName: descendant.tagName },
      );
    }
  }

  const innerHtml = index.source.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  return {
    targetRef,
    resolution: resolution.resolution,
    element,
    contentRange: { ...element.contentRange },
    innerHtml,
    normalizedInnerHtml: normalizeEditableIslandHtml(innerHtml, {
      baselineInnerHtml: innerHtml,
    }),
  };
}

export function isEditableIslandTarget(index, targetRef) {
  try {
    return {
      editable: true,
      island: editableIslandForTarget(index, targetRef),
      code: "EDITABLE_ISLAND_READY",
    };
  } catch (error) {
    if (!(error instanceof EditableIslandError)) throw error;
    return {
      editable: false,
      island: null,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
}
