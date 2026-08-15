export type NativeLayoutFingerprint = {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  display: string;
  position: string;
  font: string;
  lineHeight: string;
  whiteSpace: string;
  writingMode: string;
  transitionDuration: string;
  animationDuration: string;
  animationName: string;
  textRects: Array<{ x: number; y: number; width: number; height: number }>;
};

export function nativeLayoutFingerprint(
  element: HTMLElement,
): NativeLayoutFingerprint {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const textRects: NativeLayoutFingerprint["textRects"] = [];
  const walker = element.ownerDocument.createTreeWalker(
    element,
    element.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4,
  );
  let current = walker.nextNode();
  while (current) {
    const text = (current as Text).data;
    for (const match of text.matchAll(/[^ \t\r\n\f]+/gu)) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      const range = element.ownerDocument.createRange();
      range.setStart(current, startOffset);
      range.setEnd(current, endOffset);
      for (const textRect of Array.from(range.getClientRects())) {
        textRects.push({
          x: Math.round((textRect.x - rect.x) * 100) / 100,
          y: Math.round((textRect.y - rect.y) * 100) / 100,
          width: Math.round(textRect.width * 100) / 100,
          height: Math.round(textRect.height * 100) / 100,
        });
      }
    }
    current = walker.nextNode();
  }
  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    display: style?.display ?? "",
    position: style?.position ?? "",
    font: style?.font ?? "",
    lineHeight: style?.lineHeight ?? "",
    whiteSpace: style?.whiteSpace ?? "",
    writingMode: style?.writingMode ?? "",
    transitionDuration: style?.transitionDuration ?? "",
    animationDuration: style?.animationDuration ?? "",
    animationName: style?.animationName ?? "",
    textRects,
  };
}

export function sameNativeLayout(
  left: NativeLayoutFingerprint,
  right: NativeLayoutFingerprint,
): boolean {
  const sameTextRects = left.textRects.length === right.textRects.length
    && left.textRects.every((rect, index) => {
      const candidate = right.textRects[index];
      return Boolean(
        candidate
        && Math.abs(rect.x - candidate.x) <= 0.5
        && Math.abs(rect.y - candidate.y) <= 0.5
        && Math.abs(rect.width - candidate.width) <= 0.5
        && Math.abs(rect.height - candidate.height) <= 0.5
      );
    });
  return (
    Math.abs(left.width - right.width) <= 0.5
    && Math.abs(left.height - right.height) <= 0.5
    && left.scrollWidth === right.scrollWidth
    && left.scrollHeight === right.scrollHeight
    && sameTextRects
  );
}

export function sameNativeTextStyle(
  left: NativeLayoutFingerprint,
  right: NativeLayoutFingerprint,
  options: {
    allowUaOwnedWhiteSpace?: boolean;
  } = {},
): boolean {
  // Chromium owns white-space on a plaintext-only editing host: authored
  // `normal`, `nowrap`, or `pre-line` can be reported as `pre`/`pre-wrap`.
  // This is only a style-name exception. Geometry remains an independent gate.
  const uaOwnedEditingWhiteSpace = Boolean(options.allowUaOwnedWhiteSpace) && (
    ["normal", "nowrap", "pre-line"].includes(left.whiteSpace)
    && ["pre", "pre-wrap"].includes(right.whiteSpace)
  );
  const whiteSpaceStable = left.whiteSpace === right.whiteSpace
    || uaOwnedEditingWhiteSpace;
  return (
    left.display === right.display
    && left.position === right.position
    && left.font === right.font
    && left.lineHeight === right.lineHeight
    && whiteSpaceStable
    && left.writingMode === right.writingMode
  );
}
