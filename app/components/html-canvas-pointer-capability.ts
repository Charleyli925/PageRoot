import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import type { HtmlCanvasTargetResolution } from "./HtmlCanvasEditor.types";
import type { SourceIndexValue } from "./html-canvas-internal-types";
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

export type ResolvedCanvasPointerCapability = ReturnType<
  typeof canvasPointerCapabilityFromProof
> & Readonly<{
  element: HTMLElement;
  selectionElement: HTMLElement;
  targetKey: string;
  runtimeGenerated: boolean;
}>;

export type CanvasPointerHit =
  | Readonly<{ action: "clear" }>
  | Readonly<{ action: "select"; capability: ResolvedCanvasPointerCapability }>;

export type CanvasPointerHitInput = {
  documentNode: Document | null;
  eventTarget: EventTarget | null;
  point?: TextCaretPoint | null;
  sourceIndex: SourceIndexValue | null;
  enabled?: boolean;
  runtimeActive?: boolean;
};

export function canvasVisualTargetElement(
  element: HTMLElement | null,
  sourceIndex: SourceIndexValue | null,
): HTMLElement | null {
  if (!element || !sourceIndex) return element;
  const dedicatedSurface = element.closest("svg, math") as HTMLElement | null;
  if (dedicatedSurface?.hasAttribute(SOURCE_NODE_ATTRIBUTE)) return dedicatedSurface;
  return nativeEditHostForElement(element, sourceIndex) ?? element;
}

export function resolveCanvasPointerHit({
  documentNode,
  eventTarget,
  point,
  sourceIndex,
  enabled = true,
  runtimeActive = false,
}: CanvasPointerHitInput): CanvasPointerHit {
  if (!enabled || !documentNode) return { action: "clear" };
  if (isCanvasRootElement(eventTarget)) return { action: "clear" };
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
  const runtimeGenerated = eventTargetsRuntimeGeneratedNode(
    eventTarget,
    runtimeActive,
  );
  if (
    !hit
    || (
      !runtimeGenerated
      && (hit === documentNode.body || hit === documentNode.documentElement)
    )
  ) {
    return { action: "clear" };
  }
  if (inferSelectionLevel(hit) === "module" && !moduleHasSubstance(hit)) {
    return { action: "clear" };
  }
  const canStartTextEdit = !dedicatedSurface
    && !runtimeGenerated
    && canStartNativeTextEditAtTarget({
      documentNode,
      element: hit,
      point,
      sourceIndex,
    });
  const selection = selectionForElement(hit, sourceIndex);
  const capability = canvasPointerCapabilityFromProof({
    canStartTextEdit,
    sourceResolution: selection.resolution as HtmlCanvasTargetResolution,
  });
  return {
    action: "select",
    capability: {
      ...capability,
      element: hit,
      selectionElement: hit,
      targetKey: hit.getAttribute(SOURCE_NODE_ATTRIBUTE)
        || selection.id
        || hit.tagName,
      runtimeGenerated,
    },
  };
}

export function resolveCanvasPointerCapability(
  input: CanvasPointerHitInput,
): ResolvedCanvasPointerCapability | null {
  if (!input.sourceIndex) return null;
  const hit = resolveCanvasPointerHit(input);
  if (hit.action !== "select") return null;
  const capability = hit.capability;
  // Rich inline markup can expose several instrumented elements while the
  // pointer remains inside one native-edit host. SVG and MathML likewise keep
  // exact child selection while presenting one dedicated visual surface. Use
  // the normalized element only for hover identity and geometry; click
  // selection must retain the exact hit element.
  const hoverElement = canvasVisualTargetElement(capability.element, input.sourceIndex)
    ?? capability.element;
  return {
    ...capability,
    element: hoverElement,
    targetKey: hoverElement.getAttribute(SOURCE_NODE_ATTRIBUTE)
      || capability.targetKey,
  };
}
