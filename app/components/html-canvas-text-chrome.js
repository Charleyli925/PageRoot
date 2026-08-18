export const CANVAS_TEXT_CHROME_HORIZONTAL_INSET_PX = 4;
export const CANVAS_TEXT_CHROME_VERTICAL_INSET_PX = 2;
export const CANVAS_TEXT_CHROME_MAX_INLINE_GAP_PX = 12;

function finiteRect(rectangle) {
  const left = Number(rectangle?.left);
  const top = Number(rectangle?.top);
  const width = Number(rectangle?.width);
  const height = Number(rectangle?.height);
  if (
    !Number.isFinite(left)
    || !Number.isFinite(top)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) return null;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function sharesVisualLine(left, right) {
  const leftCenter = left.top + left.height / 2;
  const rightCenter = right.top + right.height / 2;
  return Math.abs(leftCenter - rightCenter) <= Math.max(left.height, right.height) * 0.6;
}

/**
 * Combine text-node client rects into compact, padded visual-line rectangles.
 * Separate inline islands only join when their visible gap is small, so a
 * layout with columns or media keeps independently meaningful outlines.
 */
export function normalizeCanvasTextChromeRects(
  rectangles,
  {
    horizontalInset = CANVAS_TEXT_CHROME_HORIZONTAL_INSET_PX,
    verticalInset = CANVAS_TEXT_CHROME_VERTICAL_INSET_PX,
    maxInlineGap = CANVAS_TEXT_CHROME_MAX_INLINE_GAP_PX,
  } = {},
) {
  const safeHorizontalInset = Math.max(0, Number(horizontalInset) || 0);
  const safeVerticalInset = Math.max(0, Number(verticalInset) || 0);
  const safeMaxInlineGap = Math.max(0, Number(maxInlineGap) || 0);
  const sorted = Array.from(rectangles || [], finiteRect)
    .filter(Boolean)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const lines = [];

  for (const rect of sorted) {
    const prior = lines.findLast((line) => (
      sharesVisualLine(line, rect)
      && rect.left <= line.right + safeMaxInlineGap
    ));
    if (prior) {
      prior.left = Math.min(prior.left, rect.left);
      prior.top = Math.min(prior.top, rect.top);
      prior.right = Math.max(prior.right, rect.right);
      prior.bottom = Math.max(prior.bottom, rect.bottom);
      prior.width = prior.right - prior.left;
      prior.height = prior.bottom - prior.top;
      continue;
    }
    lines.push({ ...rect });
  }

  return lines.map((line) => ({
    left: line.left - safeHorizontalInset,
    top: line.top - safeVerticalInset,
    width: line.width + safeHorizontalInset * 2,
    height: line.height + safeVerticalInset * 2,
  }));
}
