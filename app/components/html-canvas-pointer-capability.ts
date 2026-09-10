import { sourceTargetRefForSelection } from "../lib/canvas-target-rebind.js";
import { EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE } from "../domain/edit-runtime-contract.js";
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
  identifyingTextRangeAtPoint,
  findCanvasHitSourceElement,
  findCanvasSelectionElement,
  findDedicatedSourceSurfaceAtPoint,
  eventTargetsRuntimeGeneratedNode,
  isCanvasRootElement,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import {
  nativeEditHostForElement,
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
import {
  canvasPointerCapabilityFromProof,
  elementCopyAvailabilityFromProof,
  type ElementCopyAvailability,
} from "./html-canvas-pointer-proof.js";

export {
  CANVAS_POINTER_CAPABILITY_KINDS,
  CANVAS_POINTER_CAPABILITIES,
  canvasPointerCapabilityFromProof,
  elementCopyAvailabilityFromProof,
} from "./html-canvas-pointer-proof.js";
export { moduleHasSubstance } from "./html-canvas-pointer-hit.js";
export type {
  CanvasPointerCapability,
  CanvasPointerCapabilityKind,
  ElementCopyAvailability,
} from "./html-canvas-pointer-proof.js";

const OPAQUE_OR_PROGRAM_COPY_TAGS = new Set([
  "canvas",
  "embed",
  "iframe",
  "object",
  "script",
]);

type TrustedDomInspection = Readonly<{
  attributeNames: (element: Element) => string[];
  attributeValue: (element: Element, name: string) => string | null;
  child: (node: Node) => ChildNode | null;
  connected: (node: Node) => boolean;
  localName: (element: Element) => string;
  namespace: (element: Element) => string | null;
  next: (node: Node) => ChildNode | null;
  nodeType: (node: Node) => number;
  nodeValue: (node: Node) => string | null;
  parse: (source: string) => Document;
  query: (documentNode: Document, selector: string) => Element[];
  shadowRoot: (element: Element) => ShadowRoot | null;
}>;

function captureTrustedDomInspection(): TrustedDomInspection | null {
  if (
    typeof Node === "undefined"
    || typeof Element === "undefined"
    || typeof Document === "undefined"
    || typeof DOMParser === "undefined"
    || typeof NodeList === "undefined"
  ) return null;
  const apply = Reflect.apply;
  const getter = (prototype: object, name: string) => (
    Object.getOwnPropertyDescriptor(prototype, name)?.get ?? null
  );
  const nodeType = getter(Node.prototype, "nodeType");
  const nodeValue = getter(Node.prototype, "nodeValue");
  const firstChild = getter(Node.prototype, "firstChild");
  const nextSibling = getter(Node.prototype, "nextSibling");
  const isConnected = getter(Node.prototype, "isConnected");
  const localName = getter(Element.prototype, "localName");
  const namespaceURI = getter(Element.prototype, "namespaceURI")
    ?? getter(Node.prototype, "namespaceURI");
  const shadowRoot = getter(Element.prototype, "shadowRoot");
  const nodeListLength = getter(NodeList.prototype, "length");
  const getAttributeNames = Element.prototype.getAttributeNames;
  const getAttribute = Element.prototype.getAttribute;
  const querySelectorAll = Document.prototype.querySelectorAll;
  const nodeListItem = NodeList.prototype.item;
  const parseFromString = DOMParser.prototype.parseFromString;
  const TrustedDOMParser = DOMParser;
  if (
    !nodeType
    || !nodeValue
    || !firstChild
    || !nextSibling
    || !isConnected
    || !localName
    || !namespaceURI
    || !shadowRoot
    || !nodeListLength
  ) return null;
  return Object.freeze({
    attributeNames: (element) => apply(getAttributeNames, element, []),
    attributeValue: (element, name) => apply(getAttribute, element, [name]),
    child: (node) => apply(firstChild, node, []),
    connected: (node) => apply(isConnected, node, []),
    localName: (element) => apply(localName, element, []),
    namespace: (element) => apply(namespaceURI, element, []),
    next: (node) => apply(nextSibling, node, []),
    nodeType: (node) => apply(nodeType, node, []),
    nodeValue: (node) => apply(nodeValue, node, []),
    parse: (source) => apply(
      parseFromString,
      new TrustedDOMParser(),
      [source, "text/html"],
    ),
    query: (documentNode, selector) => {
      const matches = apply(querySelectorAll, documentNode, [selector]);
      const length = apply(nodeListLength, matches, []);
      const elements: Element[] = [];
      for (let index = 0; index < length; index += 1) {
        const element = apply(nodeListItem, matches, [index]);
        if (element) elements.push(element as Element);
      }
      return elements;
    },
    shadowRoot: (element) => apply(shadowRoot, element, []),
  });
}

// Captured before any authored iframe runs. Copy authority must not depend on
// DOM getters or selector methods that the authored realm can replace.
const TRUSTED_DOM_INSPECTION = captureTrustedDomInspection();

function isOpaqueOrProgramCopyElement(localName: string): boolean {
  return OPAQUE_OR_PROGRAM_COPY_TAGS.has(localName) || localName.includes("-");
}

function isProjectionOnlyAttribute(name: string, sourceHasAttribute: boolean): boolean {
  const normalized = name.toLowerCase();
  return normalized === EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE
    || normalized.startsWith("data-html-canvas-")
    || normalized.startsWith("data-pageroot-edit-runtime-")
    || (
      ["contenteditable", "role", "spellcheck"].includes(normalized)
      && !sourceHasAttribute
    );
}

function normalizedAttributes(
  inspection: TrustedDomInspection,
  element: Element,
): Array<readonly [string, string]> {
  const names = inspection.attributeNames(element);
  const result: Array<readonly [string, string]> = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    result.push([name.toLowerCase(), inspection.attributeValue(element, name) ?? ""]);
  }
  return result;
}

function attributesMatch(
  inspection: TrustedDomInspection,
  liveElement: Element,
  canonicalElement: Element,
): boolean {
  const canonical = normalizedAttributes(inspection, canonicalElement);
  const live = normalizedAttributes(inspection, liveElement);
  let authoredCount = 0;
  for (const [name, value] of live) {
    const sourceAttribute = canonical.find(([candidate]) => candidate === name);
    if (isProjectionOnlyAttribute(name, Boolean(sourceAttribute))) continue;
    authoredCount += 1;
    if (!sourceAttribute || sourceAttribute[1] !== value) return false;
  }
  return authoredCount === canonical.length;
}

function runtimeNodeMatchesSource(
  liveNode: Node,
  canonicalNode: Node,
  isProvenRuntimeSourceElement: ((element: HTMLElement) => boolean) | null,
  hasRuntimeShadowRoot: ((element: HTMLElement) => boolean) | null,
): boolean {
  const inspection = TRUSTED_DOM_INSPECTION;
  if (!inspection) return false;
  const liveNodeType = inspection.nodeType(liveNode);
  if (liveNodeType !== inspection.nodeType(canonicalNode)) return false;
  if (liveNodeType !== Node.ELEMENT_NODE) {
    return inspection.nodeValue(liveNode) === inspection.nodeValue(canonicalNode);
  }
  const liveElement = liveNode as HTMLElement;
  const canonicalElement = canonicalNode as HTMLElement;
  const liveLocalName = inspection.localName(liveElement);
  if (
    liveLocalName !== inspection.localName(canonicalElement)
    || inspection.namespace(liveElement) !== inspection.namespace(canonicalElement)
    || inspection.shadowRoot(liveElement)
    || hasRuntimeShadowRoot?.(liveElement)
    || isOpaqueOrProgramCopyElement(liveLocalName)
    || (isProvenRuntimeSourceElement && !isProvenRuntimeSourceElement(liveElement))
  ) return false;
  if (!attributesMatch(inspection, liveElement, canonicalElement)) return false;
  let liveChild = inspection.child(liveElement);
  let canonicalChild = inspection.child(canonicalElement);
  while (liveChild && canonicalChild) {
    if (!runtimeNodeMatchesSource(
      liveChild,
      canonicalChild,
      isProvenRuntimeSourceElement,
      hasRuntimeShadowRoot,
    )) return false;
    liveChild = inspection.next(liveChild);
    canonicalChild = inspection.next(canonicalChild);
  }
  return liveChild === null && canonicalChild === null;
}

function runtimeSubtreeMatchesSource(
  root: HTMLElement,
  sourceIndex: SourceIndexValue,
  isProvenRuntimeSourceElement: ((element: HTMLElement) => boolean) | null,
  hasRuntimeShadowRoot: ((element: HTMLElement) => boolean) | null,
): boolean {
  const inspection = TRUSTED_DOM_INSPECTION;
  if (!inspection) return false;
  try {
    const pagerootId = inspection.attributeValue(root, PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (!pagerootId) return false;
    const canonicalDocument = inspection.parse(sourceIndex.source);
    const selector = `[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${pagerootId}"]`;
    const matches = inspection.query(canonicalDocument, selector);
    const canonicalRoot = matches.length === 1 ? matches[0] as HTMLElement : null;
    return Boolean(
      canonicalRoot
      && runtimeNodeMatchesSource(
        root,
        canonicalRoot,
        isProvenRuntimeSourceElement,
        hasRuntimeShadowRoot,
      ),
    );
  } catch {
    return false;
  }
}

export function elementCopyAvailabilityForTarget({
  element,
  sourceIndex,
  runtimeGenerated = false,
  runtimeExpected = false,
  transientBusy = false,
  isProvenRuntimeSourceElement = null,
  hasRuntimeShadowRoot = null,
}: {
  element: HTMLElement | null;
  sourceIndex: SourceIndexValue | null;
  runtimeGenerated?: boolean;
  runtimeExpected?: boolean;
  transientBusy?: boolean;
  isProvenRuntimeSourceElement?: ((element: HTMLElement) => boolean) | null;
  hasRuntimeShadowRoot?: ((element: HTMLElement) => boolean) | null;
}): ElementCopyAvailability {
  const inspection = TRUSTED_DOM_INSPECTION;
  if (
    runtimeGenerated
    || !element
    || !inspection
    || !inspection.connected(element)
    || !sourceIndex
  ) {
    return "unsupported";
  }
  if (runtimeExpected && !isProvenRuntimeSourceElement) {
    return elementCopyAvailabilityFromProof({ transientBusy: true });
  }
  const sourceMutationAuthority = runtimeExpected
    ? Boolean(isProvenRuntimeSourceElement?.(element))
    : Boolean(inspection.attributeValue(element, PAGEROOT_ELEMENT_ID_ATTRIBUTE));
  const containsRuntimeGeneratedContent = sourceMutationAuthority
    ? !runtimeSubtreeMatchesSource(
        element,
        sourceIndex,
        runtimeExpected ? isProvenRuntimeSourceElement : null,
        runtimeExpected ? hasRuntimeShadowRoot : null,
      )
    : false;
  return elementCopyAvailabilityFromProof({
    sourceMutationAuthority,
    containsRuntimeGeneratedContent,
    transientBusy,
  });
}

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
  if (!islandHost) return false;
  // Hovering a module box, including its padding and gap, selects that module.
  // Nested text hosts still advertise in-place editing.
  if (inferSelectionLevel(element) === "module") return false;
  if (!point) return true;
  return Boolean(identifyingTextRangeAtPoint(documentNode, islandHost, point));
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
  if (dedicatedSurface?.hasAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)) return dedicatedSurface;
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
    }
    current = current.parentElement;
  }
  return null;
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
