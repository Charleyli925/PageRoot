import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import { sourceTargetRefForSelection } from "../lib/canvas-target-rebind.js";
import {
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
  /** The precise DOM object under the pointer. */
  hitElement: HTMLElement;
  /** The long-lived source object consumed by selection and operations. */
  targetElement: HTMLElement;
  /** The object whose geometry owns hover, selected chrome and the toolbar. */
  visualElement: HTMLElement;
  selection: HtmlCanvasSelection;
  sourceRef: SourceTargetRef | null;
  targetKey: string;
  generation: number;
  runtimeGenerated: boolean;
}> & ReturnType<typeof canvasPointerCapabilityFromProof>;

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
};

let transientTargetKeyGeneration: number | null = null;
let transientTargetKeySequence = 0;
let transientTargetKeys = new WeakMap<object, string>();

function normalizedGeneration(value: number | undefined): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function transientTargetKeyForElement(
  element: HTMLElement,
  generation: number,
): string {
  if (transientTargetKeyGeneration !== generation) {
    transientTargetKeyGeneration = generation;
    transientTargetKeys = new WeakMap<object, string>();
  }
  const existing = transientTargetKeys.get(element);
  if (existing) return existing;
  transientTargetKeySequence += 1;
  const key = `object:${generation}:${transientTargetKeySequence.toString(36)}`;
  transientTargetKeys.set(element, key);
  return key;
}

export function canvasTargetKeyFor({
  element,
  selection,
  sourceRef,
  generation = 0,
}: {
  element: HTMLElement;
  selection: HtmlCanvasSelection;
  sourceRef: SourceTargetRef | null;
  generation?: number;
}): string {
  const normalized = normalizedGeneration(generation);
  const elementId = sourceRef?.elementId || selection.elementId;
  if (isValidPagerootElementId(elementId)) return `element:${elementId}`;
  if (sourceRef?.targetId) return `target:${sourceRef.targetId}`;
  const nodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE) || selection.nodeId;
  if (nodeId) return `node:${normalized}:${nodeId}`;
  return transientTargetKeyForElement(element, normalized);
}

export function canvasVisualTargetElement(
  element: HTMLElement | null,
  sourceIndex: SourceIndexValue | null,
): HTMLElement | null {
  if (!element || !sourceIndex) return element;
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
}: CanvasPointerHitInput): ResolvedCanvasTarget | null {
  if (!enabled || !documentNode || !sourceIndex) return null;
  if (isCanvasRootElement(eventTarget)) return null;
  const generation = normalizedGeneration(rawGeneration);
  const dedicatedSurface = point
    ? findDedicatedSourceSurfaceAtPoint(documentNode, point)
    : null;
  const directSelection = findCanvasSelectionElement(eventTarget);
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
  const hit = directSurfaceChild
    ?? dedicatedSurface
    ?? findCanvasHitSourceElement(eventTarget)
    ?? directSelection;
  // In a Runtime frame, public source/stable-ID attributes are locators only.
  // The exact selected object must belong to the generation's sealed private
  // authority set; otherwise even a perfectly copied identity remains
  // display/comment-only.
  const runtimeGenerated = Boolean(
    isProvenRuntimeSourceElement
    && directSelection
    && !isProvenRuntimeSourceElement(directSelection)
  ) || eventTargetsRuntimeGeneratedNode(
    eventTarget,
    isProvenRuntimeSourceElement,
  );
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
  const capability = canvasPointerCapabilityFromProof({
    canStartTextEdit,
    sourceResolution: selection.resolution as HtmlCanvasTargetResolution,
  });
  const visualElement = canvasVisualTargetElement(targetElement, sourceIndex)
    ?? targetElement;
  return Object.freeze({
    ...capability,
    hitElement: hit,
    targetElement,
    visualElement,
    selection,
    sourceRef,
    targetKey: canvasTargetKeyFor({
      element: targetElement,
      selection,
      sourceRef,
      generation,
    }),
    generation,
    runtimeGenerated,
  });
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
