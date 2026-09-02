import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import { sourceTargetRefForSelection } from "../lib/canvas-target-rebind.js";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  isValidPagerootElementId,
} from "../../shared/pageroot-element-identity.mjs";
import type {
  HtmlCanvasSelection,
  HtmlCanvasTargetResolution,
} from "./HtmlCanvasEditor.types";
import type {
  SourceIndexValue,
  SourceTargetRef,
} from "./html-canvas-internal-types";
import {
  directTextNodeAtPoint,
  findCanvasHitSourceElement,
  findCanvasSelectionElement,
  findDedicatedSourceSurfaceAtPoint,
  eventTargetsRuntimeGeneratedNode,
  isCanvasRootElement,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import {
  nativeEditHostForElement,
  nativeTextFragmentForElement,
} from "./html-canvas-preview-sync";
import {
  createRuntimeVisualTargetIndex,
  type RuntimeVisualTargetIndex,
  runtimeVisualTargetAtPoint,
  runtimeVisualHintForTarget,
  runtimeVisualTargetElement,
} from "./html-canvas-runtime-target";
import {
  inferSelectionLevel,
  selectionForElement,
} from "./html-canvas-selection";
import { moduleHasSubstance } from "./html-canvas-pointer-hit.js";
import { canvasPointerCapabilityFromProof } from "./html-canvas-pointer-proof.js";

export {
  CANVAS_POINTER_CAPABILITY_KINDS,
  CANVAS_POINTER_CAPABILITIES,
  canvasPointerCapabilityFromProof,
} from "./html-canvas-pointer-proof.js";
export { moduleHasSubstance } from "./html-canvas-pointer-hit.js";
export type {
  CanvasPointerCapability,
  CanvasPointerCapabilityKind,
} from "./html-canvas-pointer-proof.js";

export function canStartNativeTextEditAtTarget({
  documentNode,
  element,
  point,
  sourceIndex,
}: {
  documentNode: Document;
  element: HTMLElement | null;
  point?: TextCaretPoint | null;
  sourceIndex: SourceIndexValue | null;
}): boolean {
  if (!element || !sourceIndex || !documentNode) return false;
  const islandHost = nativeEditHostForElement(element, sourceIndex);
  if (islandHost) return true;
  const hintedTextNode = point
    ? directTextNodeAtPoint(documentNode, element, point)
    : null;
  return Boolean(
    nativeTextFragmentForElement(element, sourceIndex, hintedTextNode),
  );
}

export type ResolvedCanvasTarget = Readonly<{
  /** The precise runtime/source DOM object under the pointer. */
  hitElement: HTMLElement;
  /** Runtime targets remain comment-only and ambiguous. */
  operationTarget: HTMLElement;
  /** The object whose geometry owns hover, selected chrome and the toolbar. */
  visualTarget: HTMLElement;
  /** The nearest privately proven exact source host used only for comments. */
  commentAnchor: SourceTargetRef | null;
  /** UI selection form of commentAnchor; never used as an operation target. */
  commentAnchorSelection: HtmlCanvasSelection | null;
  /** Compatibility alias for operationTarget. */
  targetElement: HTMLElement;
  /** Compatibility alias for visualTarget. */
  visualElement: HTMLElement;
  selection: HtmlCanvasSelection;
  sourceRef: SourceTargetRef | null;
  targetKey: string;
  /** The visual continuity identity. It is intentionally not a persistence key. */
  visualKey: string;
  generation: number;
  runtimeGenerated: boolean;
}> & ReturnType<typeof canvasPointerCapabilityFromProof>;

export type CanvasTargetIdentityScope = {
  readonly generation: number;
  readonly targetObjectKeys: WeakMap<HTMLElement, string>;
  readonly visualObjectKeys: WeakMap<HTMLElement, string>;
  runtimeVisualTargetIndex: RuntimeVisualTargetIndex | null;
};

/** @deprecated Use ResolvedCanvasTarget. Kept as a narrow compatibility name. */
export type ResolvedCanvasPointerCapability = ResolvedCanvasTarget;

export type CanvasPointerHit =
  | Readonly<{ action: "clear" }>
  | Readonly<{
    action: "select";
    target: ResolvedCanvasTarget;
    /** @deprecated Use target. This alias keeps the pointer-hit envelope stable. */
    capability: ResolvedCanvasTarget;
  }>;

export type CanvasPointerHitInput = {
  documentNode: Document | null;
  eventTarget: EventTarget | null;
  point?: TextCaretPoint | null;
  sourceIndex: SourceIndexValue | null;
  enabled?: boolean;
  isProvenRuntimeSourceElement?: ((element: HTMLElement) => boolean) | null;
  /** Ephemeral DOM generation. It is never persisted with a selection. */
  generation?: number;
  /** Per-Canvas identity scope. A missing scope is compatibility-only. */
  identityScope?: CanvasTargetIdentityScope | null;
};

function normalizedGeneration(value: number | undefined): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

export function createCanvasTargetIdentityScope(
  generation = 0,
): CanvasTargetIdentityScope {
  return {
    generation: normalizedGeneration(generation),
    targetObjectKeys: new WeakMap<HTMLElement, string>(),
    visualObjectKeys: new WeakMap<HTMLElement, string>(),
    runtimeVisualTargetIndex: null,
  };
}

function transientTargetKeyForElement(
  element: HTMLElement,
  generation: number,
  objectKeys: WeakMap<HTMLElement, string>,
): string {
  const existing = objectKeys.get(element);
  if (existing) return existing;
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const key = `object:${generation}:${suffix}`;
  objectKeys.set(element, key);
  return key;
}

export function canvasTargetKeyFor({
  element,
  selection,
  sourceRef,
  generation = 0,
  identityScope,
  runtimeGenerated = false,
}: {
  element: HTMLElement;
  selection: HtmlCanvasSelection;
  sourceRef: SourceTargetRef | null;
  generation?: number;
  identityScope?: CanvasTargetIdentityScope | null;
  runtimeGenerated?: boolean;
}): string {
  const normalized = normalizedGeneration(generation);
  const scope = identityScope?.generation === normalized
    ? identityScope
    : createCanvasTargetIdentityScope(normalized);
  if (!runtimeGenerated) {
    const elementId = [sourceRef?.elementId, selection.elementId]
      .find((candidate) => isValidPagerootElementId(candidate));
    if (elementId) return `element:${elementId}`;
    if (sourceRef?.targetId) return `target:${sourceRef.targetId}`;
    const nodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE) || selection.nodeId;
    if (nodeId) return `node:${normalized}:${nodeId}`;
  }
  return transientTargetKeyForElement(
    element,
    normalized,
    scope.targetObjectKeys,
  );
}

function canvasVisualKeyFor({
  element,
  generation,
  identityScope,
  runtimeGenerated,
}: {
  element: HTMLElement;
  generation: number;
  identityScope?: CanvasTargetIdentityScope | null;
  runtimeGenerated: boolean;
}): string {
  const normalized = normalizedGeneration(generation);
  const scope = identityScope?.generation === normalized
    ? identityScope
    : createCanvasTargetIdentityScope(normalized);
  if (!runtimeGenerated) {
    const elementId = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (isValidPagerootElementId(elementId)) return `element:${elementId}`;
    const nodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
    if (nodeId) return `node:${normalized}:${nodeId}`;
  }
  return transientTargetKeyForElement(
    element,
    normalized,
    scope.visualObjectKeys,
  );
}

export function canvasVisualTargetElement(
  element: HTMLElement | null,
  sourceIndex: SourceIndexValue | null,
  options: { runtimeGenerated?: boolean } = {},
): HTMLElement | null {
  if (!element || !sourceIndex) return element;
  if (options.runtimeGenerated) {
    return runtimeVisualTargetElement(element) ?? element;
  }
  const dedicatedSurface = element.closest("svg, math") as HTMLElement | null;
  if (dedicatedSurface?.hasAttribute(SOURCE_NODE_ATTRIBUTE)) return dedicatedSurface;
  return nativeEditHostForElement(element, sourceIndex) ?? element;
}

function sourceRefForSelection(
  selection: HtmlCanvasSelection,
  runtimeGenerated: boolean,
): SourceTargetRef | null {
  if (
    runtimeGenerated
    || (selection.resolution !== "exact" && selection.resolution !== "rebound")
  ) return null;
  try {
    return sourceTargetRefForSelection(selection) as SourceTargetRef;
  } catch {
    return null;
  }
}

function canonicalTargetElement(
  hitElement: HTMLElement,
  dedicatedSurface: HTMLElement | null,
  sourceIndex: SourceIndexValue,
  runtimeGenerated: boolean,
): HTMLElement {
  // Dedicated surfaces own their own target semantics. SVG/MathML children
  // remain exact source targets while canvas/form/media roots stay atomic.
  if (dedicatedSurface || runtimeGenerated) return hitElement;
  return nativeEditHostForElement(hitElement, sourceIndex) ?? hitElement;
}

export function resolveCanvasTarget({
  documentNode,
  eventTarget,
  point,
  sourceIndex,
  enabled = true,
  isProvenRuntimeSourceElement = null,
  generation: rawGeneration = 0,
  identityScope: rawIdentityScope = null,
}: CanvasPointerHitInput): ResolvedCanvasTarget | null {
  if (!enabled || !documentNode || !sourceIndex) return null;
  if (isCanvasRootElement(eventTarget)) return null;
  const generation = normalizedGeneration(rawGeneration);
  const identityScope = rawIdentityScope?.generation === generation
    ? rawIdentityScope
    : createCanvasTargetIdentityScope(generation);
  if (
    isProvenRuntimeSourceElement
    && point
    && (
      !identityScope.runtimeVisualTargetIndex
      || identityScope.runtimeVisualTargetIndex.disposed
    )
  ) {
    identityScope.runtimeVisualTargetIndex = createRuntimeVisualTargetIndex(documentNode);
  }
  const dedicatedSurface = point
    ? findDedicatedSourceSurfaceAtPoint(documentNode, point)
    : null;
  const directSelection = findCanvasSelectionElement(eventTarget);
  const runtimeDirectSelection = findCanvasSelectionElement(eventTarget, {
    preserveRuntimeSurface: true,
  });
  const runtimePointTarget = point
    ? runtimeVisualTargetAtPoint({
        documentNode,
        point,
        isProvenSourceElement: isProvenRuntimeSourceElement,
        runtimeVisualTargetIndex: identityScope.runtimeVisualTargetIndex,
      })
    : null;
  // A dedicated surface such as <canvas> needs point-based selection so its
  // wrapping module is never selected. For a concrete child inside an SVG,
  // however, keep that child as the exact comment target instead of widening
  // the selection to the SVG root.
  const directSurfaceChild = dedicatedSurface
    && directSelection
    && directSelection !== dedicatedSurface
    && dedicatedSurface.contains(directSelection)
    ? directSelection
    : null;
  // In a Runtime frame, public source/stable-ID attributes are locators only.
  // The exact selected object must belong to the generation's sealed private
  // authority set; otherwise even a perfectly copied identity remains
  // display/comment-only.
  const runtimeGenerated = Boolean(
    runtimePointTarget
    || (
    isProvenRuntimeSourceElement
    && directSelection
    && !isProvenRuntimeSourceElement(directSelection)
    )
  ) || eventTargetsRuntimeGeneratedNode(
    eventTarget,
    isProvenRuntimeSourceElement,
  );
  const hit = runtimeGenerated
    ? directSurfaceChild
      ?? runtimePointTarget
      ?? runtimeDirectSelection
      ?? dedicatedSurface
      ?? directSelection
      ?? findCanvasHitSourceElement(eventTarget)
    : directSurfaceChild
      ?? dedicatedSurface
      ?? findCanvasHitSourceElement(eventTarget)
      ?? directSelection;
  if (
    !hit
    || (
      !runtimeGenerated
      && (hit === documentNode.body || hit === documentNode.documentElement)
    )
  ) {
    return null;
  }
  if (inferSelectionLevel(hit) === "module" && !moduleHasSubstance(hit)) return null;
  const canStartTextEdit = !dedicatedSurface
    && !runtimeGenerated
    && canStartNativeTextEditAtTarget({
      documentNode,
      element: hit,
      point,
      sourceIndex,
    });
  const targetElement = canonicalTargetElement(
    hit,
    dedicatedSurface,
    sourceIndex,
    runtimeGenerated,
  );
  const selection = runtimeGenerated
    ? selectionForElement(targetElement, null, undefined, "ambiguous")
    : selectionForElement(targetElement, sourceIndex);
  const sourceRef = sourceRefForSelection(selection, runtimeGenerated);
  const commentAnchorData = runtimeGenerated
    ? runtimeCommentAnchorForTarget(
        targetElement,
        documentNode,
        sourceIndex,
        isProvenRuntimeSourceElement,
      )
    : {
        element: targetElement,
        selection,
        ref: sourceRef,
      };
  const visualElement = runtimeGenerated
    ? runtimeVisualTargetElement(targetElement) ?? targetElement
    : canvasVisualTargetElement(
      targetElement,
      sourceIndex,
      { runtimeGenerated },
    ) ?? targetElement;
  const visualHint = runtimeGenerated && commentAnchorData?.element
    ? runtimeVisualHintForTarget({
        sourceHost: commentAnchorData.element,
        visualTarget: visualElement,
        cache: identityScope.runtimeVisualTargetIndex?.hintCache,
      })
    : null;
  const selectionWithVisualHint = visualHint
    ? {
        ...selection,
        label: visualHint.label,
        visualHint,
      }
    : selection;
  const capability = canvasPointerCapabilityFromProof({
    canStartTextEdit,
    sourceResolution: selectionWithVisualHint.resolution as HtmlCanvasTargetResolution,
  });
  return Object.freeze({
    ...capability,
    hitElement: hit,
    targetElement,
    operationTarget: targetElement,
    visualTarget: visualElement,
    commentAnchor: commentAnchorData?.ref ?? null,
    commentAnchorSelection: commentAnchorData?.selection ?? null,
    visualElement,
    selection: selectionWithVisualHint,
    sourceRef,
    targetKey: canvasTargetKeyFor({
      element: targetElement,
      selection: selectionWithVisualHint,
      sourceRef,
      generation,
      identityScope,
      runtimeGenerated,
    }),
    visualKey: canvasVisualKeyFor({
      element: visualElement,
      generation,
      identityScope,
      runtimeGenerated,
    }),
    generation,
    runtimeGenerated,
  });
}

function runtimeCommentAnchorForTarget(
  targetElement: HTMLElement,
  documentNode: Document,
  sourceIndex: SourceIndexValue,
  isProvenRuntimeSourceElement: ((element: HTMLElement) => boolean) | null,
): {
  element: HTMLElement;
  selection: HtmlCanvasSelection;
  ref: SourceTargetRef;
} | null {
  if (!isProvenRuntimeSourceElement) return null;
  let current: HTMLElement | null = targetElement;
  let pageFallback: {
    element: HTMLElement;
    selection: HtmlCanvasSelection;
    ref: SourceTargetRef;
  } | null = null;
  while (current) {
    if (isProvenRuntimeSourceElement(current)) {
      const rawSelection = selectionForElement(
        current,
        sourceIndex,
        undefined,
        "exact",
      );
      const isPageRoot = current === documentNode.body
        || current === documentNode.documentElement;
      const selection = isPageRoot
        ? {
            ...rawSelection,
            label: "整个页面",
            selector: "body",
            level: "module" as const,
            tagName: "body",
            text: "",
            resolution: "exact" as const,
          }
        : rawSelection;
      const ref = sourceTargetRefForSelection(selection) as SourceTargetRef;
      if (isValidPagerootElementId(selection.elementId)) {
        return { element: current, selection, ref };
      }
      if (isPageRoot && selection.resolution === "exact") {
        pageFallback = { element: current, selection, ref };
      }
    }
    current = current.parentElement;
  }
  return pageFallback;
}

export function resolveCanvasPointerHit(input: CanvasPointerHitInput): CanvasPointerHit {
  const target = resolveCanvasTarget(input);
  if (!target) return { action: "clear" };
  return {
    action: "select",
    target,
    capability: target,
  };
}

export function resolveCanvasPointerCapability(
  input: CanvasPointerHitInput,
): ResolvedCanvasPointerCapability | null {
  // Compatibility callers receive the canonical result directly. There is
  // deliberately no second visual/selection resolution in this exit.
  return resolveCanvasTarget(input);
}
