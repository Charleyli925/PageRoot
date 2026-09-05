export function insertionLayoutNeedsRefresh(previous, next) {
  if (!next) return Boolean(previous);
  if (!previous) return true;
  return previous.sourceSha256 !== next.sourceSha256
    || previous.documentNode !== next.documentNode;
}

export function structuralInsertionKey(selection) {
  const offset = selection?.sourceAnchor?.startOffset;
  if (Number.isSafeInteger(offset) && typeof selection?.selector === "string" && selection.selector) {
    return `${selection.selector}:${offset}`;
  }
  return typeof selection?.id === "string" && selection.id ? selection.id : "";
}

export function uniqueStructuralInsertionPoints(points) {
  const seen = new Map();
  for (const point of points || []) {
    const key = structuralInsertionKey(point?.selection);
    if (!key || seen.has(key)) continue;
    seen.set(key, point);
  }
  return [...seen.values()].sort((left, right) => {
    const leftOffset = left.selection?.sourceAnchor?.startOffset;
    const rightOffset = right.selection?.sourceAnchor?.startOffset;
    const leftRank = Number.isSafeInteger(leftOffset) ? leftOffset : Number.MAX_SAFE_INTEGER;
    const rightRank = Number.isSafeInteger(rightOffset) ? rightOffset : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.selection?.id || "").localeCompare(String(right.selection?.id || ""));
  });
}
