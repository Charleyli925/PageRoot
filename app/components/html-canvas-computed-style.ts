export type SelectedStyle = {
  fontSize: number;
  color: string;
  backgroundColor: string;
  padding: number;
  margin: number;
  lineHeight: number;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
};

export type EditableStyleProperty =
  | "fontSize"
  | "color"
  | "backgroundColor"
  | "fontWeight"
  | "fontStyle"
  | "textDecorationLine"
  | "padding"
  | "margin"
  | "lineHeight";

export const STYLE_PROPERTY_CONFIGS: ReadonlyArray<{
  property: EditableStyleProperty;
  cssProperty: string;
  label: string;
}> = [
  { property: "fontSize", cssProperty: "font-size", label: "字号" },
  { property: "color", cssProperty: "color", label: "文字颜色" },
  { property: "backgroundColor", cssProperty: "background-color", label: "填充" },
  { property: "fontWeight", cssProperty: "font-weight", label: "字重" },
  { property: "fontStyle", cssProperty: "font-style", label: "字形" },
  { property: "textDecorationLine", cssProperty: "text-decoration-line", label: "下划线" },
  { property: "padding", cssProperty: "padding-top", label: "内边距" },
  { property: "margin", cssProperty: "margin-top", label: "外间距" },
  { property: "lineHeight", cssProperty: "line-height", label: "行距" },
];

export const TEXT_RANGE_EDITABLE_PROPERTIES = new Set<EditableStyleProperty>([
  "fontSize",
  "color",
  "backgroundColor",
  "fontWeight",
  "fontStyle",
  "textDecorationLine",
]);

function computedStyleFor(element: HTMLElement): CSSStyleDeclaration | null {
  return element.ownerDocument.defaultView?.getComputedStyle(element) || null;
}

function styleIsBold(style: CSSStyleDeclaration): boolean {
  return style.fontWeight === "bold" || Number.parseInt(style.fontWeight, 10) >= 600;
}

function styleIsItalic(style: CSSStyleDeclaration): boolean {
  return style.fontStyle === "italic" || style.fontStyle === "oblique";
}

function styleIsUnderline(style: CSSStyleDeclaration): boolean {
  return style.textDecorationLine.split(/\s+/u).includes("underline");
}

function roundedPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

/**
 * Read the browser's resolved presentation for one selected element.
 *
 * The optional range is the set of DOM elements represented by the active
 * text selection. It is used only to calculate the three range-wide toggles;
 * all values still come directly from computed style.
 */
export function readComputedEditableStyle(
  element: HTMLElement,
  textRange?: readonly HTMLElement[],
): SelectedStyle {
  const computedStyle = computedStyleFor(element);
  const rangeElements = (textRange?.length ? textRange : [element])
    .filter((candidate) => candidate.isConnected);
  const rangeStyles = (rangeElements.length ? rangeElements : [element])
    .map(computedStyleFor)
    .filter((style): style is CSSStyleDeclaration => Boolean(style));
  const primaryStyle = computedStyle || rangeStyles[0] || null;
  const fontSize = primaryStyle?.fontSize || "";
  const lineHeight = primaryStyle?.lineHeight || "";

  return {
    fontSize: Math.max(1, roundedPixels(fontSize, 16)),
    color: toHexColor(primaryStyle?.color || "", "#202124"),
    backgroundColor: toHexColor(primaryStyle?.backgroundColor || "", "#ffffff"),
    padding: roundedPixels(primaryStyle?.paddingTop || "", 0),
    margin: roundedPixels(primaryStyle?.marginTop || "", 0),
    lineHeight: Math.max(
      1,
      roundedPixels(lineHeight, roundedPixels(fontSize, 16) * 1.5),
    ),
    isBold: rangeStyles.length > 0 && rangeStyles.every(styleIsBold),
    isItalic: rangeStyles.length > 0 && rangeStyles.every(styleIsItalic),
    isUnderline: rangeStyles.length > 0 && rangeStyles.every(styleIsUnderline),
  };
}

export function toHexColor(value: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const channels = value.match(/[\d.]+/g)?.slice(0, 4).map(Number);
  if (
    !channels
    || channels.length < 3
    || (channels.length === 4 && channels[3] === 0)
  ) return fallback;
  return `#${channels
    .slice(0, 3)
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16).padStart(2, "0"))
    .join("")}`;
}
