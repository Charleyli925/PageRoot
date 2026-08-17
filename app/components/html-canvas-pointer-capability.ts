import { EDIT_RUNTIME_HOST_ATTRIBUTE } from "../domain/edit-runtime-contract.js";
import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-patch-core.js";
import type { HtmlCanvasTargetResolution } from "./HtmlCanvasEditor.types";
import type { SourceIndexValue } from "./html-canvas-internal-types";
import {
  directTextNodeAtPoint,
  findCanvasHitSourceElement,
  findCanvasSelectionElement,
  findDedicatedSourceSurfaceAtPoint,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import {
  nativeEditHostForElement,
  nativeTextFragmentForElement,
} from "./html-canvas-preview-sync";
import { selectionForElement } from "./html-canvas-selection";
import { canvasPointerCapabilityFromProof } from "./html-canvas-pointer-proof.js";

export {
  CANVAS_POINTER_CAPABILITY_KINDS,
  CANVAS_POINTER_CAPABILITIES,
  canvasPointerCapabilityFromProof,
} from "./html-canvas-pointer-proof.js";
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

export function resolveCanvasPointerCapability({
  documentNode,
  eventTarget,
  point,
  sourceIndex,
  enabled = true,
}: {
  documentNode: Document | null;
  eventTarget: EventTarget | null;
  point?: TextCaretPoint | null;
  sourceIndex: SourceIndexValue | null;
  enabled?: boolean;
}): ResolvedCanvasPointerCapability | null {
  if (!enabled || !documentNode || !sourceIndex) return null;
  const dedicatedSurface = point
    ? findDedicatedSourceSurfaceAtPoint(documentNode, point)
    : null;
  const hit = dedicatedSurface
    ?? findCanvasHitSourceElement(eventTarget)
    ?? findCanvasSelectionElement(eventTarget);
  if (!hit) return null;
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
    ...capability,
    element: hit,
    targetKey: hit.getAttribute(SOURCE_NODE_ATTRIBUTE)
      || selection.id
      || hit.tagName,
  };
}
