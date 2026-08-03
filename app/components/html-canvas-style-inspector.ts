import { selectorForElement } from "./html-canvas-dom";

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
  sources: StyleSourceInfo[];
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

type StyleSourceKind = "inline" | "rule" | "variable" | "inherit" | "initial" | "default";

export type StyleSourceInfo = {
  property: EditableStyleProperty;
  cssProperty: string;
  label: string;
  computedValue: string;
  kind: StyleSourceKind;
  selector: string;
  source: string;
  mediaCondition: string;
  sharedImpactCount: number;
  important: boolean;
  variableName?: string;
};

type StyleDeclarationCandidate = {
  value: string;
  important: boolean;
  selector: string;
  source: string;
  mediaCondition: string;
  sharedImpactCount: number;
  specificity: [number, number, number, number];
  order: number;
};

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

const NATURALLY_INHERITED_PROPERTIES = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "visibility",
  "white-space",
  "word-spacing",
]);

function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote: "'" | '"' | null = null;
  for (const character of selectorText) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (character === "," && bracketDepth === 0 && parenthesisDepth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function selectorSpecificity(selector: string): [number, number, number, number] {
  const withoutWhere = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  const idCount = withoutWhere.match(/#[\w-]+/g)?.length ?? 0;
  const classCount = (
    withoutWhere.match(/\.[\w-]+/g)?.length ?? 0
  ) + (
    withoutWhere.match(/\[[^\]]+\]/g)?.length ?? 0
  ) + (
    withoutWhere.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0
  );
  const pseudoElementCount = withoutWhere.match(/::[\w-]+/g)?.length ?? 0;
  const typeCount = withoutWhere.match(/(?:^|[\s>+~,(])(?:[a-z][\w-]*)(?=[#.:[\s>+~),]|$)/gi)?.length ?? 0;
  return [0, idCount, classCount, typeCount + pseudoElementCount];
}

function compareSpecificity(
  left: [number, number, number, number],
  right: [number, number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function styleSheetSourceLabel(
  documentNode: Document,
  sheet: CSSStyleSheet,
  sheetIndex: number,
): string {
  if (sheet.href) return `<link> ${sheet.href}`;
  const ownerNode = sheet.ownerNode;
  if (ownerNode && "nodeName" in ownerNode && ownerNode.nodeName.toLowerCase() === "style") {
    const styleElements = Array.from(documentNode.querySelectorAll("style"));
    const styleIndex = styleElements.indexOf(ownerNode as HTMLStyleElement);
    return `<style> #${styleIndex >= 0 ? styleIndex + 1 : sheetIndex + 1}`;
  }
  return `样式表 #${sheetIndex + 1}`;
}

function matchingSelector(element: HTMLElement, selectorText: string): string | null {
  const selectors = splitSelectorList(selectorText);
  const matches = selectors.filter((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
  if (matches.length === 0) {
    try {
      return element.matches(selectorText) ? selectorText : null;
    } catch {
      return null;
    }
  }
  return matches.sort((left, right) =>
    compareSpecificity(selectorSpecificity(right), selectorSpecificity(left))
  )[0];
}

function sharedSelectorImpact(documentNode: Document, selectorText: string): number {
  const impactedElements = new Set<Element>();
  for (const selector of splitSelectorList(selectorText)) {
    try {
      documentNode.querySelectorAll(selector).forEach((element) => {
        impactedElements.add(element);
      });
    } catch {
      // A malformed selector must not widen the reported shared impact.
    }
  }
  return impactedElements.size;
}

function activeMediaCondition(view: Window | null, condition: string): boolean {
  if (!condition) return true;
  if (!view) return false;
  try {
    return view.matchMedia(condition).matches;
  } catch {
    return false;
  }
}

function activeSupportsCondition(view: Window | null, condition: string): boolean {
  if (!condition) return true;
  if (!view) return false;
  const css = (view as Window & {
    CSS?: { supports: (conditionText: string) => boolean };
  }).CSS;
  if (!css?.supports) return false;
  try {
    return css.supports(condition);
  } catch {
    return false;
  }
}

function styleDeclarationCandidates(
  element: HTMLElement,
  cssProperty: string,
): StyleDeclarationCandidate[] {
  const documentNode = element.ownerDocument;
  const view = documentNode.defaultView;
  const candidates: StyleDeclarationCandidate[] = [];
  let order = 0;

  const visitRuleList = (
    rules: CSSRuleList,
    source: string,
    inheritedMediaCondition = "",
  ) => {
    for (const rule of Array.from(rules)) {
      order += 1;
      if ("selectorText" in rule && "style" in rule) {
        const styleRule = rule as CSSStyleRule;
        const selector = matchingSelector(element, styleRule.selectorText);
        if (!selector) continue;
        const value = styleRule.style.getPropertyValue(cssProperty).trim();
        if (!value) continue;
        candidates.push({
          value,
          important: styleRule.style.getPropertyPriority(cssProperty) === "important",
          selector,
          source,
          mediaCondition: inheritedMediaCondition,
          sharedImpactCount: sharedSelectorImpact(documentNode, styleRule.selectorText),
          specificity: selectorSpecificity(selector),
          order,
        });
        continue;
      }

      if ("styleSheet" in rule && (rule as CSSImportRule).styleSheet) {
        const importRule = rule as CSSImportRule;
        const importMedia = importRule.media?.mediaText || "";
        if (!activeMediaCondition(view, importMedia)) continue;
        try {
          visitRuleList(
            importRule.styleSheet!.cssRules,
            importRule.href || source,
            [inheritedMediaCondition, importMedia].filter(Boolean).join(" and "),
          );
        } catch {
          // Cross-origin styles may affect the computed result while keeping
          // their rule list intentionally opaque to the renderer.
        }
        continue;
      }

      if ("cssRules" in rule) {
        const groupingRule = rule as CSSGroupingRule & { conditionText?: string };
        const condition = typeof groupingRule.conditionText === "string"
          ? groupingRule.conditionText
          : "";
        if (rule.type === 4 && !activeMediaCondition(view, condition)) continue;
        if (rule.type === 12 && !activeSupportsCondition(view, condition)) continue;
        visitRuleList(
          groupingRule.cssRules,
          source,
          [inheritedMediaCondition, condition].filter(Boolean).join(" and "),
        );
      }
    }
  };

  Array.from(documentNode.styleSheets).forEach((sheet, sheetIndex) => {
    if (sheet.disabled) return;
    const sheetMedia = sheet.media?.mediaText || "";
    if (!activeMediaCondition(view, sheetMedia)) return;
    try {
      visitRuleList(
        sheet.cssRules,
        styleSheetSourceLabel(documentNode, sheet, sheetIndex),
        sheetMedia,
      );
    } catch {
      // A cross-origin sheet is read-only and may not expose cssRules.
    }
  });

  const inlineValue = element.style.getPropertyValue(cssProperty).trim();
  if (inlineValue) {
    candidates.push({
      value: inlineValue,
      important: element.style.getPropertyPriority(cssProperty) === "important",
      selector: "inline style",
      source: "当前元素开始标签的 style 属性",
      mediaCondition: "",
      sharedImpactCount: 1,
      specificity: [1, 0, 0, 0],
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  return candidates;
}

function winningStyleCandidate(
  candidates: StyleDeclarationCandidate[],
): StyleDeclarationCandidate | null {
  return candidates.reduce<StyleDeclarationCandidate | null>((winner, candidate) => {
    if (!winner) return candidate;
    if (winner.important !== candidate.important) {
      return candidate.important ? candidate : winner;
    }
    const specificity = compareSpecificity(candidate.specificity, winner.specificity);
    if (specificity !== 0) return specificity > 0 ? candidate : winner;
    return candidate.order >= winner.order ? candidate : winner;
  }, null);
}

function styleSourceForProperty(
  element: HTMLElement,
  property: EditableStyleProperty,
  cssProperty: string,
  label: string,
): StyleSourceInfo {
  const documentNode = element.ownerDocument;
  const view = documentNode.defaultView;
  const computedValue = view?.getComputedStyle(element).getPropertyValue(cssProperty).trim() || "";
  const winner = winningStyleCandidate(styleDeclarationCandidates(element, cssProperty));
  const variableName = winner?.value.match(/var\(\s*(--[\w-]+)/)?.[1];
  const winnerKeyword = winner?.value.trim().toLowerCase();
  const naturallyInherited = NATURALLY_INHERITED_PROPERTIES.has(cssProperty);
  const explicitlyInherited = winnerKeyword === "inherit"
    || (winnerKeyword === "unset" && naturallyInherited);
  const explicitlyInitial = winnerKeyword === "initial"
    || (winnerKeyword === "unset" && !naturallyInherited);

  if (winner && variableName) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: "variable",
      selector: winner.selector,
      source: winner.source,
      mediaCondition: winner.mediaCondition || "无",
      sharedImpactCount: winner.sharedImpactCount,
      important: winner.important,
      variableName,
    };
  }

  if (winner && !explicitlyInherited && !explicitlyInitial) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: winner.selector === "inline style" ? "inline" : "rule",
      selector: winner.selector,
      source: winner.source,
      mediaCondition: winner.mediaCondition || "无",
      sharedImpactCount: winner.sharedImpactCount,
      important: winner.important,
    };
  }

  if (winner && explicitlyInitial) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: "initial",
      selector: winner.selector,
      source: winner.source,
      mediaCondition: winner.mediaCondition || "无",
      sharedImpactCount: winner.sharedImpactCount,
      important: winner.important,
    };
  }

  const parent = element.parentElement;
  const parentComputedValue = parent && view
    ? view.getComputedStyle(parent).getPropertyValue(cssProperty).trim()
    : "";
  if (
    explicitlyInherited
    || (
      naturallyInherited
      && parent
      && parentComputedValue === computedValue
    )
  ) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: "inherit",
      selector: winner?.selector || (parent ? selectorForElement(parent) : "父元素"),
      source: winner?.source || "父元素的 computed style",
      mediaCondition: winner?.mediaCondition || "无",
      sharedImpactCount: winner?.sharedImpactCount ?? (parent ? 1 : 0),
      important: winner?.important || false,
    };
  }

  return {
    property,
    cssProperty,
    label,
    computedValue,
    kind: "default",
    selector: "—",
    source: "浏览器默认样式",
    mediaCondition: "无",
    sharedImpactCount: 0,
    important: false,
  };
}

export function styleSourcesForElement(element: HTMLElement): StyleSourceInfo[] {
  return STYLE_PROPERTY_CONFIGS.map(({ property, cssProperty, label }) =>
    styleSourceForProperty(element, property, cssProperty, label)
  );
}

export function toHexColor(value: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const channels = value.match(/[\d.]+/g)?.slice(0, 4).map(Number);
  if (!channels || channels.length < 3 || (channels.length === 4 && channels[3] === 0)) return fallback;
  return `#${channels
    .slice(0, 3)
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}
