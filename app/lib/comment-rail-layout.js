/**
 * Place comment-rail items in document order without allowing focus or
 * expansion state to reorder them. Items that share a target keep their
 * explicit order, so saved comments can remain ahead of the unsaved draft.
 *
 * @param {{
 *   items: Array<{
 *     key: string;
 *     targetTop: number;
 *     height: number;
 *     order: number;
 *   }>;
 *   minimumTop: number;
 *   gap?: number;
 * }} input
 */
export function layoutCommentRailItems({
  items,
  minimumTop,
  gap = 20,
}) {
  const safeMinimumTop = Number.isFinite(minimumTop)
    ? Math.max(0, minimumTop)
    : 0;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const orderedItems = items
    .map((item, inputIndex) => ({
      ...item,
      inputIndex,
      targetTop: Number.isFinite(item.targetTop)
        ? Math.max(safeMinimumTop, item.targetTop)
        : safeMinimumTop,
      height: Number.isFinite(item.height) ? Math.max(0, item.height) : 0,
      order: Number.isFinite(item.order) ? item.order : inputIndex,
    }))
    .sort((left, right) => (
      left.targetTop - right.targetTop
      || left.order - right.order
      || left.inputIndex - right.inputIndex
    ));

  /** @type {Record<string, number>} */
  const positions = {};
  /** @type {Record<string, number>} */
  const heights = {};
  let cursor = safeMinimumTop;
  for (const item of orderedItems) {
    const top = Math.max(cursor, item.targetTop);
    positions[item.key] = top;
    heights[item.key] = item.height;
    cursor = top + item.height + safeGap;
  }

  return {
    positions,
    heights,
    bottom: Math.max(safeMinimumTop, cursor),
    orderedKeys: orderedItems.map((item) => item.key),
  };
}
