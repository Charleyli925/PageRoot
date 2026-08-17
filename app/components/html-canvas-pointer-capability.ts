import { EDIT_RUNTIME_HOST_ATTRIBUTE } from "../domain/edit-runtime-contract.js";
import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import type { HtmlCanvasTargetResolution } from "./HtmlCanvasEditor.types";
import type { SourceIndexValue } from "./html-canvas-internal-types";
import {
  directTextNodeAtPoint,
  findCanvasHitSourceElement,
  findCanvasSelectionElement,
  findDedicatedSourceSurfaceAtPoint,
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
  if (element.closest(`[${EDIT_RUNTIME_HOST_ATTRIBUTE}]`)) return false;
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
  targetKey: string;
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
};

export function resolveCanvasPointerHit({
  documentNode,
  eventTarget,
  point,
  sourceIndex,
  enabled = true,
}: CanvasPointerHitInput): CanvasPointerHit {
  if (!enabled || !documentNode) return { action: "clear" };
  if (isCanvasRootElement(eventTarget)) return { action: "clear" };
  const dedicatedSurface = point
    ? findDedicatedSourceSurfaceAtPoint(documentNode, point)
    : null;
  const hit = dedicatedSurface
    ?? findCanvasHitSourceElement(eventTarget)
    ?? findCanvasSelectionElement(eventTarget);
  if (
    !hit
    || hit === documentNode.body
    || hit === documentNode.documentElement
  ) {
    return { action: "clear" };
  }
  if (inferSelectionLevel(hit) === "module" && !moduleHasSubstance(hit)) {
    return { action: "clear" };
  }
  const canStartTextEdit = !dedicatedSurface
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
      targetKey: hit.getAttribute(SOURCE_NODE_ATTRIBUTE)
        || selection.id
        || hit.tagName,
    },
  };
}

export function resolveCanvasPointerCapability(
  input: CanvasPointerHitInput,
): ResolvedCanvasPointerCapability | null {
  if (!input.sourceIndex) return null;
  const hit = resolveCanvasPointerHit(input);
  return hit.action === "select" ? hit.capability : null;
}
