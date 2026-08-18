export type CanvasTextChromeRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export const CANVAS_TEXT_CHROME_HORIZONTAL_INSET_PX: 4;
export const CANVAS_TEXT_CHROME_VERTICAL_INSET_PX: 2;
export const CANVAS_TEXT_CHROME_MAX_INLINE_GAP_PX: 12;

export function normalizeCanvasTextChromeRects(
  rectangles: Iterable<CanvasTextChromeRect | null | undefined>,
  options?: {
    horizontalInset?: number;
    verticalInset?: number;
    maxInlineGap?: number;
  },
): CanvasTextChromeRect[];
