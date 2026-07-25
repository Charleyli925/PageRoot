export const COMMENT_VIRTUALIZATION_THRESHOLD = 40;
export const COMMENT_VIRTUAL_OVERSCAN = 1_000;

/**
 * Comments keep independent TargetRef ids for audit history, but markers that
 * point at the same exact source range should share one Canvas control.
 *
 * @param {{
 *   id?: string;
 *   selector?: string;
 *   level?: string;
 *   text?: string;
 *   textQuote?: string;
 *   sourceAnchor?: {
 *     startOffset?: number;
 *     endOffset?: number;
 *     sourceSha256?: string;
 *   };
 * }} target
 * @returns {string}
 */
export function commentMarkerGroupKey(target) {
  const anchor = target?.sourceAnchor;
  if (anchor) {
    return [
      target.selector || "",
      target.level || "",
      anchor.sourceSha256 || "",
      anchor.startOffset ?? "",
      anchor.endOffset ?? "",
      target.textQuote || target.text || "",
    ].join("\u0000");
  }
  return [
    target?.selector || "",
    target?.level || "",
    target?.textQuote || target?.text || "",
    target?.id || "",
  ].join("\u0000");
}

/**
 * @param {{
 *   ids: string[];
 *   positions: Record<string, number>;
 *   heights: Record<string, number>;
 *   viewportTop: number;
 *   viewportHeight: number;
 *   forcedIds?: string[];
 * }} options
 * @returns {Set<string>}
 */
export function virtualizedCommentIds({
  ids,
  positions,
  heights,
  viewportTop,
  viewportHeight,
  forcedIds = [],
}) {
  if (ids.length <= COMMENT_VIRTUALIZATION_THRESHOLD) return new Set(ids);
  const start = Math.max(0, viewportTop - COMMENT_VIRTUAL_OVERSCAN);
  const end = viewportTop + Math.max(1, viewportHeight) + COMMENT_VIRTUAL_OVERSCAN;
  const visible = new Set(forcedIds.filter(Boolean));
  for (const id of ids) {
    const top = Number(positions[id] ?? 0);
    const height = Math.max(1, Number(heights[id] ?? 180));
    if (top <= end && top + height >= start) visible.add(id);
  }
  return visible;
}
