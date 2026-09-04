import {
  applyPatchPlan,
  createTargetRef,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import {
  sourceTargetRefForSelection,
  targetLevelForSelection,
} from "../lib/canvas-target-rebind.js";
import { sourceElementFromDom } from "./html-canvas-source-element";
import { selectorForElement } from "./html-canvas-dom";
import type {
  HtmlCanvasSelection,
  HtmlCanvasSelectionLevel,
  HtmlCanvasTargetResolution,
} from "./HtmlCanvasEditor.types";
import type { SourceIndexValue, SourceTargetRef } from "./html-canvas-internal-types";

export type MoveAvailability = {
  up: boolean;
  down: boolean;
};

function visibleText(element: HTMLElement): string {
  const value = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  return value.length > 42 ? `${value.slice(0, 42)}…` : value;
}

function svgSourceLabel(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const directTitle = Array.from(element.children).find(
    (child) => child.tagName.toLowerCase() === "title",
  )?.textContent;
  const value = (
    element.getAttribute("aria-label")
    || element.getAttribute("title")
    || directTitle
    || (tagName === "text" ? element.textContent : "")
    || element.id
    || ""
  ).replace(/\s+/g, " ").trim();
  return value.length > 42 ? `${value.slice(0, 42)}…` : value;
}

function selectionText(element: HTMLElement): string {
  return element.namespaceURI === "http://www.w3.org/2000/svg"
    ? svgSourceLabel(element)
    : visibleText(element);
}

export function readableLabel(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const typeLabel: Record<string, string> = {
    a: "链接",
    article: "文章模块",
    aside: "侧边模块",
    blockquote: "引用",
    button: "按钮",
    footer: "页脚",
    form: "表单",
    h1: "一级标题",
    h2: "二级标题",
    h3: "三级标题",
    h4: "标题",
    header: "页头模块",
    img: "图片",
    li: "列表项",
    main: "主内容",
    nav: "导航模块",
    p: "正文",
    section: "内容模块",
    table: "表格",
    ul: "列表",
    ol: "列表",
    svg: "SVG 图形",
    g: "SVG 分组",
    path: "SVG 路径",
    line: "SVG 线条",
    text: "SVG 文字",
    circle: "SVG 圆形",
    ellipse: "SVG 椭圆",
    rect: "SVG 矩形",
    polyline: "SVG 折线",
    polygon: "SVG 多边形",
    use: "SVG 图形引用",
  };
  const label = element.namespaceURI === "http://www.w3.org/2000/svg"
    ? svgSourceLabel(element)
    : (
        element.getAttribute("aria-label")
        || element.getAttribute("alt")
        || element.getAttribute("title")
        || visibleText(element)
      );
  const prefix = typeLabel[tagName] || tagName.toUpperCase();
  return label ? `${prefix} · ${label}` : prefix;
}

export function inferSelectionLevel(element: HTMLElement): HtmlCanvasSelectionLevel {
  const explicitLevel = element.getAttribute("data-ai-level");
  if (explicitLevel === "module" || explicitLevel === "part") return explicitLevel;

  const moduleTags = new Set(["ARTICLE", "ASIDE", "FOOTER", "HEADER", "MAIN", "NAV", "SECTION"]);
  const identity = `${element.id} ${element.getAttribute("class") || ""}`.toLowerCase();
  const hasModuleIdentity = /(^|[\s_-])(module|section|panel|card|block|container)([\s_-]|$)/.test(identity);
  const directBodyBlock = element.parentElement === element.ownerDocument.body &&
    !["A", "BUTTON", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "P", "SPAN"].includes(element.tagName);
  return moduleTags.has(element.tagName) || hasModuleIdentity || directBodyBlock ? "module" : "part";
}

export function defaultGlobalCommentElement(documentNode: Document): HTMLElement | null {
  return documentNode.body;
}

export function isPageRootElement(element: Element | null): element is HTMLElement {
  return Boolean(
    element
    && (
      element === element.ownerDocument.body
      || element === element.ownerDocument.documentElement
    ),
  );
}

export function isPageRootSelection(selection: HtmlCanvasSelection | null): boolean {
  return Boolean(
    selection
    && selection.level === "module"
    && (selection.tagName === "body" || selection.tagName === "html"),
  );
}

export function sourceMoveAvailability(
  sourceIndex: SourceIndexValue | null,
  selection: HtmlCanvasSelection | null,
): MoveAvailability {
  if (
    !sourceIndex
    || !selection
    || selection.level === "insertion"
    || selection.resolution === "ambiguous"
    || selection.resolution === "orphaned"
  ) {
    return { up: false, down: false };
  }
  try {
    const resolution = resolveTargetRef(
      sourceIndex,
      sourceTargetRefForSelection(selection),
    );
    const element = resolution.target;
    if (!element || element.type !== "element") return { up: false, down: false };
    const parent = element.parentId ? sourceIndex.byNodeId.get(element.parentId) : null;
    if (
      parent?.type !== "element"
      || ["body", "html"].includes(element.tagName)
      || ["html", "head"].includes(parent.tagName)
    ) {
      return { up: false, down: false };
    }
    const previous = element.previousElementSiblingId
      ? sourceIndex.byNodeId.get(element.previousElementSiblingId)
      : null;
    const next = element.nextElementSiblingId
      ? sourceIndex.byNodeId.get(element.nextElementSiblingId)
      : null;
    return {
      up: previous?.type === "element",
      down: next?.type === "element",
    };
  } catch {
    return { up: false, down: false };
  }
}

export function uniqueSelections(
  targets: readonly HtmlCanvasSelection[],
): HtmlCanvasSelection[] {
  const byTargetId = new Map<string, HtmlCanvasSelection>();
  for (const target of targets) {
    if (target.id && !byTargetId.has(target.id)) byTargetId.set(target.id, target);
  }
  return [...byTargetId.values()];
}

export function trackedSourceTargetRefs(
  targets: readonly HtmlCanvasSelection[],
  operationTargetRefs: readonly SourceTargetRef[],
  options: {
    includeUnresolvedTargetIds?: ReadonlySet<string>;
  } = {},
): SourceTargetRef[] {
  const operationTargetIds = new Set(
    operationTargetRefs.map((target) => target.targetId),
  );
  return uniqueSelections(targets).flatMap((target) => {
    if (
      (
        operationTargetIds.has(target.id)
      )
      || (
        (
          target.resolution === "ambiguous"
          || target.resolution === "orphaned"
        )
        && !options.includeUnresolvedTargetIds?.has(target.id)
      )
    ) return [];
    return [sourceTargetRefForSelection(target)];
  });
}

export function selectionFromRefreshedTarget(
  original: HtmlCanvasSelection,
  targetRef: SourceTargetRef,
  nodeId?: string,
): HtmlCanvasSelection {
  return {
    id: targetRef.targetId,
    ...(targetRef.elementId ? { elementId: targetRef.elementId } : {}),
    ...(targetRef.expectedSourceSha256
      ? { expectedSourceSha256: targetRef.expectedSourceSha256 }
      : original.expectedSourceSha256
        ? { expectedSourceSha256: original.expectedSourceSha256 }
        : {}),
    ...(nodeId ? { nodeId } : {}),
    label: targetRef.label,
    selector: targetRef.selector || "",
    level: original.level,
    tagName: targetRef.level === "insertion-point"
      ? "insertion"
      : targetRef.fingerprint?.tagName || original.tagName,
    text: targetRef.textQuote || "",
    resolution: targetRef.resolution,
    ...(targetRef.textQuote !== undefined ? { textQuote: targetRef.textQuote } : {}),
    ...(original.textLocator ? { textLocator: original.textLocator } : {}),
    ...(targetRef.sourceAnchor ? { sourceAnchor: targetRef.sourceAnchor } : {}),
    ...(targetRef.fingerprint ? { fingerprint: targetRef.fingerprint } : {}),
  };
}

export function deterministicTargetUpdates(
  result: ReturnType<typeof applyPatchPlan>,
  originalTargets: readonly HtmlCanvasSelection[],
): HtmlCanvasSelection[] {
  const originals = new Map(
    uniqueSelections(originalTargets).map((target) => [target.id, target]),
  );
  const refreshedTargetRefs = [
    ...result.refreshedTargetRefs.map((targetRef: SourceTargetRef) => ({
      targetRef,
      tracked: false,
    })),
    ...result.refreshedTrackedTargetRefs.map((targetRef: SourceTargetRef) => ({
      targetRef,
      tracked: true,
    })),
  ];
  return refreshedTargetRefs.flatMap(({ targetRef, tracked }) => {
    const original = originals.get(targetRef.targetId);
    if (!original) return [];
    const mapping = result.targetMappings.find((candidate) => (
      candidate.targetId === targetRef.targetId
      && Boolean(candidate.tracked) === tracked
    ));
    return [
      selectionFromRefreshedTarget(
        original,
        targetRef as SourceTargetRef,
        mapping?.afterNodeId || undefined,
      ),
    ];
  });
}

export function deterministicOperationTargetUpdate(
  result: ReturnType<typeof applyPatchPlan>,
  original: HtmlCanvasSelection,
): HtmlCanvasSelection | null {
  const targetRef = result.refreshedTargetRefs.find(
    (candidate: SourceTargetRef) => candidate.targetId === original.id,
  ) as SourceTargetRef | undefined;
  if (!targetRef) return null;
  const mapping = result.targetMappings.find((candidate) => (
    candidate.targetId === original.id
    && !candidate.tracked
  ));
  return selectionFromRefreshedTarget(
    original,
    targetRef,
    mapping?.afterNodeId || undefined,
  );
}

export function selectionForElement(
  element: HTMLElement,
  sourceIndex?: SourceIndexValue | null,
  identityTarget?: HtmlCanvasSelection | null,
  resolutionOverride?: HtmlCanvasTargetResolution,
  levelOverride?: HtmlCanvasSelectionLevel,
): HtmlCanvasSelection {
  const selector = selectorForElement(element);
  const level = levelOverride ?? identityTarget?.level ?? inferSelectionLevel(element);
  const sourceElement = sourceElementFromDom(element, sourceIndex);
  let targetRef: SourceTargetRef | null = null;
  if (sourceIndex && sourceElement) {
    try {
      targetRef = createTargetRef(sourceIndex, sourceElement, {
        level: targetLevelForSelection(level),
        ...(identityTarget?.id ? { targetId: identityTarget.id } : {}),
        ...(identityTarget?.label ? { label: identityTarget.label } : {}),
      }) as SourceTargetRef;
    } catch {
      targetRef = null;
    }
  }
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  return {
    id: targetRef?.targetId || sourceElement?.pagerootId || element.getAttribute("data-ai-id") || element.id || selector,
    ...(targetRef?.elementId ? { elementId: targetRef.elementId } : {}),
    ...(targetRef?.expectedSourceSha256
      ? { expectedSourceSha256: targetRef.expectedSourceSha256 }
      : {}),
    label: level === "module" && isPageRootElement(element)
      ? "整个页面"
      : readableLabel(element),
    selector: targetRef?.selector || selector,
    level,
    tagName: element.tagName.toLowerCase(),
    text: selectionText(element),
    resolution: resolutionOverride || (targetRef ? "exact" : "orphaned"),
    ...(targetRef?.textQuote ? { textQuote: targetRef.textQuote } : {}),
    ...(identityTarget?.textLocator ? { textLocator: identityTarget.textLocator } : {}),
    ...(targetRef?.sourceAnchor ? { sourceAnchor: targetRef.sourceAnchor } : {}),
    ...(targetRef?.fingerprint ? { fingerprint: targetRef.fingerprint } : {}),
    boundingBox: {
      x: Math.round((rect.left + (view?.scrollX || 0)) * 100) / 100,
      y: Math.round((rect.top + (view?.scrollY || 0)) * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
  };
}
