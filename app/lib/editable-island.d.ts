export class EditableIslandError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export type EditableIslandTargetRef = {
  targetId: string;
  label: string;
  level: string;
  resolution: string;
  sourceAnchor?: {
    startOffset: number;
    endOffset: number;
    sourceSha256: string;
  };
};

export type EditableIslandDescriptor = {
  targetRef: EditableIslandTargetRef;
  resolution: string;
  element: Record<string, unknown> & {
    nodeId: string;
    tagName: string;
    contentRange: { startOffset: number; endOffset: number };
  };
  contentRange: { startOffset: number; endOffset: number };
  innerHtml: string;
  normalizedInnerHtml: string;
};

export function normalizeEditableIslandHtml(
  value: string,
  options?: { baselineInnerHtml?: string },
): string;

export function normalizeEditableTextFragmentHtml(
  value: string,
  options?: { baselineInnerHtml?: string },
): string;

export function editableIslandForTarget(
  index: Record<string, unknown>,
  targetRef: EditableIslandTargetRef,
): EditableIslandDescriptor;

export function isEditableIslandTarget(
  index: Record<string, unknown>,
  targetRef: EditableIslandTargetRef,
):
  | { editable: true; island: EditableIslandDescriptor; code: "EDITABLE_ISLAND_READY" }
  | {
      editable: false;
      island: null;
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
