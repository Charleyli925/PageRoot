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
    .map((item, inputIndex) => {
      if (!Number.isFinite(item.targetTop)) {
        throw new TypeError(`Comment rail target "${item.key}" has no measured coordinate.`);
      }
      return {
        ...item,
        inputIndex,
        targetTop: Math.max(safeMinimumTop, item.targetTop),
        height: Number.isFinite(item.height) ? Math.max(0, item.height) : 0,
        order: Number.isFinite(item.order) ? item.order : inputIndex,
      };
    })
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

/**
 * Translate the complete comment queue without changing its DOM or source
 * order, so one explicitly focused card can share a viewport Y coordinate
 * with its Canvas target.
 *
 * @param {{ targetTop: number; cardTop: number }} input
 */
export function computeAlignedRailOffset({ targetTop, cardTop }) {
  if (!Number.isFinite(targetTop) || !Number.isFinite(cardTop)) return 0;
  return Math.min(0, targetTop - cardTop);
}

/**
 * When focused alignment has hidden earlier cards above the rail, upward wheel
 * motion first restores that queue toward its natural position. Any unused
 * wheel delta remains available to the shared document scroller.
 *
 * @param {{ offset: number; deltaY: number }} input
 */
export function consumeRailRestoreWheel({ offset, deltaY }) {
  const safeOffset = Number.isFinite(offset) ? Math.min(0, offset) : 0;
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
  if (safeOffset >= 0 || safeDeltaY >= 0) {
    return {
      offset: safeOffset,
      consumed: 0,
      remainder: safeDeltaY,
    };
  }

  const requestedRestore = -safeDeltaY;
  const availableRestore = -safeOffset;
  const consumed = Math.min(requestedRestore, availableRestore);
  return {
    offset: Math.min(0, safeOffset + consumed),
    consumed,
    remainder: safeDeltaY + consumed,
  };
}

/**
 * Route wheel input from the comment region into the shared Canvas/page
 * scroller. The page has priority in both directions. The only exception is
 * upward motion after the page reaches its top, which restores comments hidden
 * above the rail by explicit focus alignment.
 *
 * @param {{
 *   pageScrollTop: number;
 *   pageMaxScrollTop: number;
 *   railOffset: number;
 *   deltaY: number;
 * }} input
 */
export function routeCommentRailWheel({
  pageScrollTop,
  pageMaxScrollTop,
  railOffset,
  deltaY,
}) {
  const safeMaxScrollTop = Number.isFinite(pageMaxScrollTop)
    ? Math.max(0, pageMaxScrollTop)
    : 0;
  const safePageScrollTop = Number.isFinite(pageScrollTop)
    ? Math.max(0, Math.min(safeMaxScrollTop, pageScrollTop))
    : 0;
  const safeRailOffset = Number.isFinite(railOffset)
    ? Math.min(0, railOffset)
    : 0;
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;

  let nextPageScrollTop = safePageScrollTop;
  let nextRailOffset = safeRailOffset;
  let remainder = safeDeltaY;

  if (safeDeltaY > 0) {
    const availablePageDistance = safeMaxScrollTop - safePageScrollTop;
    const pageDistance = Math.min(safeDeltaY, availablePageDistance);
    nextPageScrollTop += pageDistance;
    remainder -= pageDistance;
  } else if (safeDeltaY < 0) {
    const requestedPageDistance = -safeDeltaY;
    const pageDistance = Math.min(requestedPageDistance, safePageScrollTop);
    nextPageScrollTop -= pageDistance;
    remainder += pageDistance;

    if (nextPageScrollTop <= 0 && remainder < 0 && safeRailOffset < 0) {
      const restored = consumeRailRestoreWheel({
        offset: safeRailOffset,
        deltaY: remainder,
      });
      nextRailOffset = restored.offset;
      remainder = restored.remainder;
    }
  }

  return {
    pageScrollTop: nextPageScrollTop,
    railOffset: nextRailOffset,
    pageDelta: nextPageScrollTop - safePageScrollTop,
    railDelta: nextRailOffset - safeRailOffset,
    remainder,
  };
}
