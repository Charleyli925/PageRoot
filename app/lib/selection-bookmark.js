import { RuntimeDomSourceMapError } from "./runtime-dom-source-map.js";

export class SelectionBookmarkError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SelectionBookmarkError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SelectionBookmarkError(code, message, details);
}

function assertSelection(selection) {
  if (!selection || typeof selection !== "object") {
    fail("INVALID_SELECTION", "A browser Selection-like object is required.");
  }
}

function assertBookmark(bookmark) {
  if (
    !bookmark
    || bookmark.version !== 1
    || !bookmark.anchor
    || !bookmark.focus
  ) {
    fail("INVALID_SELECTION_BOOKMARK", "A valid selection bookmark is required.");
  }
}

/**
 * Capture anchor and focus independently. Their order is intentionally not
 * normalised, so a backwards browser selection remains backwards.
 */
export function createSelectionBookmark(selection, runtimeMap, options = {}) {
  assertSelection(selection);
  if (!selection.anchorNode || !selection.focusNode) {
    fail("EMPTY_SELECTION", "The current selection has no anchor or focus node.");
  }
  const collapsed = Boolean(selection.isCollapsed)
    || (
      selection.anchorNode === selection.focusNode
      && selection.anchorOffset === selection.focusOffset
    );
  const anchorAffinity = options.anchorAffinity ?? "right";
  const focusAffinity = options.focusAffinity ?? (collapsed ? anchorAffinity : "left");
  const rootRuntimeId = options.root
    ? runtimeMap.runtimeIdForNode(options.root)
    : null;
  return {
    version: 1,
    sourceSha256: options.sourceSha256 ?? null,
    rootRuntimeId,
    collapsed,
    anchor: runtimeMap.domPointToSourceAnchor(
      selection.anchorNode,
      selection.anchorOffset,
      anchorAffinity,
    ),
    focus: runtimeMap.domPointToSourceAnchor(
      selection.focusNode,
      selection.focusOffset,
      focusAffinity,
    ),
  };
}

export function resolveSelectionBookmark(bookmark, runtimeMap, options = {}) {
  try {
    assertBookmark(bookmark);
    if (
      options.sourceSha256
      && bookmark.sourceSha256
      && options.sourceSha256 !== bookmark.sourceSha256
      && options.allowSourceMismatch !== true
    ) {
      return {
        ok: false,
        code: "SELECTION_SOURCE_MISMATCH",
        reason: "The selection belongs to a different source revision.",
      };
    }
    const root = options.root
      ?? (bookmark.rootRuntimeId
        ? runtimeMap.nodeForRuntimeId(bookmark.rootRuntimeId)
        : null);
    if (bookmark.rootRuntimeId && !root) {
      return {
        ok: false,
        code: "SELECTION_ROOT_NOT_MAPPED",
        reason: "The selection root is no longer present in the current DOM.",
      };
    }
    const anchor = runtimeMap.sourceAnchorToDomPoint(bookmark.anchor, { root });
    const focus = runtimeMap.sourceAnchorToDomPoint(bookmark.focus, { root });
    return {
      ok: true,
      anchorNode: anchor.node,
      anchorOffset: anchor.offset,
      focusNode: focus.node,
      focusOffset: focus.offset,
      collapsed: bookmark.collapsed,
    };
  } catch (error) {
    if (
      error instanceof RuntimeDomSourceMapError
      || error instanceof SelectionBookmarkError
    ) {
      return {
        ok: false,
        code: error.code,
        reason: error.message,
        details: error.details,
      };
    }
    throw error;
  }
}

/**
 * Restore through Selection.setBaseAndExtent where available. This preserves
 * selection direction and does not focus, blur, or mutate the editing root.
 */
export function restoreSelectionBookmark(
  selection,
  bookmark,
  runtimeMap,
  options = {},
) {
  assertSelection(selection);
  const resolved = resolveSelectionBookmark(bookmark, runtimeMap, options);
  if (!resolved.ok) return resolved;

  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(
      resolved.anchorNode,
      resolved.anchorOffset,
      resolved.focusNode,
      resolved.focusOffset,
    );
    return { ok: true };
  }
  if (
    typeof selection.collapse === "function"
    && typeof selection.extend === "function"
  ) {
    selection.collapse(resolved.anchorNode, resolved.anchorOffset);
    if (
      resolved.anchorNode !== resolved.focusNode
      || resolved.anchorOffset !== resolved.focusOffset
    ) {
      selection.extend(resolved.focusNode, resolved.focusOffset);
    }
    return { ok: true };
  }
  return {
    ok: false,
    code: "SELECTION_RESTORE_UNSUPPORTED",
    reason: "This Selection object cannot restore anchor and focus.",
  };
}
