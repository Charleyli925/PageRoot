import type { SourceIndexValue } from "./html-canvas-internal-types";

export const SOURCE_ELEMENT_ATTRIBUTE: string;

export function escapedPagerootElementId(elementId: string): string;
export function sourceElementSelector(elementId: string): string;
export function sourceElementId(element: { getAttribute?(name: string): string | null } | null | undefined): string | null;
export function uniqueSourceElement(
  documentNode: Document,
  elementId: string,
): HTMLElement | null;

export type RuntimeSourceAuthority = {
  elementGeneration: number;
  executionId: string;
  elements: WeakSet<HTMLElement>;
  pagerootIds: WeakMap<HTMLElement, string>;
};

export function grantEditorCreatedSourceElements(options: {
  authority: RuntimeSourceAuthority | null | undefined;
  documentNode: Document | null | undefined;
  sourceIndex: SourceIndexValue | null | undefined;
  expectedGeneration: number;
  expectedExecutionId: string;
  createdElements: readonly HTMLElement[];
  allowedElementIds: readonly string[];
  markerAttribute: string;
}): { ok: true } | { ok: false; reason: string };

export function revokeRemovedSourceElements(options: {
  authority: RuntimeSourceAuthority | null | undefined;
  removedElements: readonly HTMLElement[];
  markerAttribute: string;
}): void;
